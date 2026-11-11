// Stage 7: the retry rules. Pure functions, so these tests need no fakes at all.
import { describe, expect, it } from 'vitest'
import {
  BASE_DELAY_MS, MAX_ATTEMPTS, MAX_DELAY_MS, QUOTA_FALLBACK_WAIT_MS, backoffDelayMs, decideRetry, isTemporaryHttpStatus,
} from '../services/recovery/retryPolicy.js'
import { AiError, describeGeminiError } from '../services/ai/geminiClient.js'
import { AutomationError, describeN8nError } from '../services/automation/automationClient.js'

const now = new Date('2026-11-10T12:00:00.000Z')
const minutesLater = (iso) => (Date.parse(iso) - now.getTime()) / 60_000

describe('backoffDelayMs: exponential backoff', () => {
  it('doubles: 5, 10, 20, 40 minutes, then stops at 60', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffDelayMs(n) / 60_000)).toEqual([5, 10, 20, 40, 60, 60])
    expect(backoffDelayMs(1)).toBe(BASE_DELAY_MS)
    expect(backoffDelayMs(50)).toBe(MAX_DELAY_MS)
  })

  it('treats nonsense input as the first attempt', () => {
    expect(backoffDelayMs(0)).toBe(BASE_DELAY_MS)
    expect(backoffDelayMs(-3)).toBe(BASE_DELAY_MS)
  })
})

describe('decideRetry', () => {
  const temp = (kind, extra = {}) => ({ kind, temporary: true, ...extra })

  it('a temporary error is retried with backoff, until MAX_ATTEMPTS', () => {
    const plan = [1, 2, 3].map((failedAttempts) => decideRetry({ error: temp('timeout'), failedAttempts, now }))
    expect(plan.map((d) => d.action)).toEqual(['retry', 'retry', 'retry'])
    expect(plan.map((d) => minutesLater(d.nextRetryAt))).toEqual([5, 10, 20])
    expect(plan.every((d) => d.countsAsAttempt)).toBe(true)
    expect(plan[0].reason).toMatch(/try 2 of 4 in 5 min/)
  })

  it(`after ${MAX_ATTEMPTS} failed tries it escalates (no endless retries)`, () => {
    const decision = decideRetry({ error: temp('timeout'), failedAttempts: MAX_ATTEMPTS, now })
    expect(decision).toEqual({ action: 'escalate', reason: expect.stringMatching(/after 4 tries \(timeout\)/) })
    expect(decideRetry({ error: temp('timeout'), failedAttempts: 99, now }).action).toBe('escalate')
  })

  it.each(['auth', 'api_disabled', 'permission', 'model_not_found', 'blocked', 'bad_request', 'not_found'])(
    'a permanent error (%s) escalates at once, even on the first failure',
    (kind) => {
      const decision = decideRetry({ error: { kind, temporary: false }, failedAttempts: 1, now })
      expect(decision.action).toBe('escalate')
      expect(decision.reason).toContain(kind)
    },
  )

  it('an error without a clear "temporary: true" is treated as permanent (safe default)', () => {
    expect(decideRetry({ error: { kind: 'weird' }, failedAttempts: 1, now }).action).toBe('escalate')
    expect(decideRetry({ error: new Error('boom'), failedAttempts: 1, now }).action).toBe('escalate')
    expect(decideRetry({ error: null, failedAttempts: 1, now }).action).toBe('escalate')
    // and it says honestly that the cause is unknown (not "permanent")
    expect(decideRetry({ error: { kind: 'unknown', temporary: false }, failedAttempts: 1, now }).reason).toMatch(/^Unknown error: to be safe it is not retried automatically/)
  })

  it('quota_exhausted waits for the reset Google gives, and does NOT use up an attempt', () => {
    const decision = decideRetry({ error: temp('quota_exhausted', { retryAfterSeconds: 7 * 3600 }), failedAttempts: 1, now })
    expect(decision).toMatchObject({ action: 'retry', countsAsAttempt: false })
    expect(minutesLater(decision.nextRetryAt)).toBe(7 * 60)
  })

  it('quota_exhausted without a reset time checks again in 1 hour', () => {
    const decision = decideRetry({ error: temp('quota_exhausted'), failedAttempts: 1, now })
    expect(minutesLater(decision.nextRetryAt)).toBe(QUOTA_FALLBACK_WAIT_MS / 60_000)
  })

  it('quota_exhausted is never escalated just for the number of tries (it is not the task\'s fault)', () => {
    expect(decideRetry({ error: temp('quota_exhausted'), failedAttempts: MAX_ATTEMPTS + 5, now }).action).toBe('retry')
  })

  it('rate_limited waits at least as long as the service asked', () => {
    const decision = decideRetry({ error: temp('rate_limited', { retryAfterSeconds: 30 * 60 }), failedAttempts: 1, now })
    expect(minutesLater(decision.nextRetryAt)).toBe(30) // 30 > the 5-minute backoff
    const short = decideRetry({ error: temp('rate_limited', { retryAfterSeconds: 10 }), failedAttempts: 1, now })
    expect(minutesLater(short.nextRetryAt)).toBe(5) // the backoff is longer than the 10 s asked
  })

  it('works with our REAL error classes (the temporary flags they already set)', () => {
    const gem = (status, body) => decideRetry({ error: describeGeminiError(status, body), failedAttempts: 1, now }).action
    expect(gem(503, {})).toBe('retry') // Google overloaded
    expect(gem(401, {})).toBe('escalate') // wrong key
    expect(gem(404, {})).toBe('escalate') // model not found
    expect(decideRetry({ error: new AiError('timeout', 'x', { temporary: true }), failedAttempts: 1, now }).action).toBe('retry')

    const n8n = (status) => decideRetry({ error: describeN8nError(status), failedAttempts: 1, now }).action
    expect(n8n(500)).toBe('retry')
    expect(n8n(404)).toBe('escalate') // workflow not active: a person must activate it
    expect(n8n(403)).toBe('escalate') // keys differ
    expect(decideRetry({ error: new AutomationError('unreachable', 'x', { temporary: true }), failedAttempts: 1, now }).action).toBe('retry')
  })
})

describe('isTemporaryHttpStatus', () => {
  it('only 408, 429 and 5xx are worth retrying', () => {
    expect([408, 429, 500, 502, 503, 504].every(isTemporaryHttpStatus)).toBe(true)
    expect([200, 400, 401, 403, 404, 409, 413, 422].some(isTemporaryHttpStatus)).toBe(false)
  })
})
