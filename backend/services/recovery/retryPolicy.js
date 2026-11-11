// RETRY POLICY (Stage 7): decides, for one failed task, "try again later, or call a person?"
//
// Pure functions: no network, no storage, no clock of their own (the caller passes `now`).
// Every error type we have (AiError, StorageError, AutomationError) already carries
//   kind       what went wrong, e.g. "timeout", "auth", "quota_exhausted"
//   temporary  true if trying again later may work
// so this file only needs those two facts.
//
// The rules:
//   permanent error (temporary: false)  → escalate at once. Retrying a wrong API key or an invalid
//                                         ZIP code can never work, it only wastes time and quota.
//   quota_exhausted (the DAILY AI limit) → wait until the quota resets. Doesn't use up an attempt:
//                                         it isn't the task's fault, and retrying sooner is pointless.
//   other temporary errors              → exponential backoff: 5, 10, 20 minutes...
//                                         at most MAX_ATTEMPTS tries in total, then escalate.
//   rate_limited with a "retry after"   → wait at least that long.

export const MAX_ATTEMPTS = 4 // 1 first try + 3 automatic retries
export const BASE_DELAY_MS = 5 * 60_000 // 5 minutes (the recovery sweep runs every 5 minutes)
export const MAX_DELAY_MS = 60 * 60_000 // never wait more than 1 hour between tries
export const QUOTA_FALLBACK_WAIT_MS = 60 * 60_000 // quota reset time unknown → check again in 1 hour

/**
 * Backoff before the next try, after `failedAttempts` failures (1, 2, 3...).
 * 1 → 5 min, 2 → 10 min, 3 → 20 min, 4 → 40 min, then capped at 60 min.
 * Doubling the wait gives a struggling service room to recover, instead of hammering it.
 */
export function backoffDelayMs(failedAttempts) {
  const n = Math.max(1, Math.floor(failedAttempts))
  return Math.min(BASE_DELAY_MS * 2 ** (n - 1), MAX_DELAY_MS)
}

/**
 * Decides what to do after a failure.
 *
 * error:          { kind, temporary, retryAfterSeconds? }  (AiError, StorageError, AutomationError...)
 * failedAttempts: how many tries have failed so far, INCLUDING this one (counted attempts only)
 * now:            a Date
 *
 * Returns one of:
 *   { action: 'retry',    nextRetryAt: ISO string, countsAsAttempt: boolean, reason }
 *   { action: 'escalate', reason }
 * `reason` is a short, plain-English explanation for the dashboard.
 */
export function decideRetry({ error, failedAttempts, now }) {
  const kind = error?.kind ?? 'unknown'
  const temporary = error?.temporary === true // anything not clearly temporary is treated as permanent
  const at = (ms) => new Date(now.getTime() + ms).toISOString()

  if (!temporary) {
    // "unknown" is not proven permanent, but we can't know a retry is safe: a person decides.
    const why = kind === 'unknown'
      ? 'Unknown error: to be safe it is not retried automatically'
      : `Permanent error (${kind}): retrying cannot fix it`
    return { action: 'escalate', reason: `${why}, a person must look.` }
  }

  if (kind === 'quota_exhausted') {
    const waitMs = error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : QUOTA_FALLBACK_WAIT_MS
    return {
      action: 'retry',
      nextRetryAt: at(waitMs),
      countsAsAttempt: false,
      reason: 'The daily AI quota is used up: waiting for it to reset (this does not use up an attempt).',
    }
  }

  if (failedAttempts >= MAX_ATTEMPTS) {
    return { action: 'escalate', reason: `Still failing after ${failedAttempts} tries (${kind}): a person must look.` }
  }

  let waitMs = backoffDelayMs(failedAttempts)
  if (error.retryAfterSeconds) waitMs = Math.max(waitMs, error.retryAfterSeconds * 1000) // respect the service
  return {
    action: 'retry',
    nextRetryAt: at(waitMs),
    countsAsAttempt: true,
    reason: `Temporary error (${kind}): try ${failedAttempts + 1} of ${MAX_ATTEMPTS} in ${Math.round(waitMs / 60_000)} min.`,
  }
}

/**
 * For HTTP answers from OUR backend (used by n8n's logic and tests): is this status worth retrying?
 * 408 timeout, 429 too many requests and 5xx server problems are temporary.
 * Every other 4xx (400 invalid, 401 wrong key, 404 not found, 409 conflict) is permanent.
 */
export function isTemporaryHttpStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}
