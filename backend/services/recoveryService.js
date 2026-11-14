// RECOVERY RECORDS (Stage 7): one record per problem the system is trying to fix by itself.
//
//   recordFailure  something failed → open (or update) its record, and let the retry policy
//                  decide: "retry at <time>" or "escalate to a person"
//   recordSuccess  it worked (automatically or because a person retried) → "recovered"
//
// Record life cycle:   pending_retry ──(works)──► recovered
//                           │
//                           └──(permanent error, or too many tries)──► escalated ──(a person fixes it)──► recovered
//
// Every change also writes an activity event, so the dashboard shows what the system did:
//   type "recovery"   scheduled / retried / recovered
//   type "escalation" "NEEDS A PERSON: ..." (same wording as n8n's WF4)
// This file never retries anything itself: the Recovery Agent does (agents/recoveryAgent.js).
import { randomBytes } from 'node:crypto'
import { logger as defaultLogger } from '../utils/logger.js'
import * as leadStore from './leadStore.js'
import { decideRetry } from './recovery/retryPolicy.js'

// What a recovery record can be about, with a label for messages. Only these exist.
export const RECOVERY_KINDS = {
  qualification: 'AI qualification', //         target: a lead     (Step 2)
  followup_event: 'n8n hand-off', //            target: a follow-up (Step 3: "followup.approved" did not reach n8n)
  hot_lead_event: 'Hot-lead alert', //          target: a lead      (Step 3: "lead.qualified" did not reach n8n)
  followup_delivery: 'Delivery', //             target: a follow-up (Step 3: stuck in "sending", may have been sent)
}

export const OPEN_STATUSES = ['pending_retry', 'escalated'] // not finished yet

const clean = (text) => String(text ?? '').replace(/https?:\/\/\S+/gi, '[URL hidden]').replace(/\s+/g, ' ').trim().slice(0, 300)

export function createRecoveryService({ store = leadStore, logger = defaultLogger, now = () => new Date() } = {}) {
  /** The open record (pending_retry or escalated) for this problem, or null. */
  async function findOpen(kind, targetId) {
    const all = await store.listRecoveries()
    return all.find((r) => r.kind === kind && r.targetId === targetId && OPEN_STATUSES.includes(r.status)) ?? null
  }

  async function audit(type, message, leadId) {
    try {
      await store.insertActivity({ id: `EV-rc-${Date.now()}-${randomBytes(2).toString('hex')}`, type, message, leadId, timestamp: now().toISOString() })
    } catch (err) {
      logger.warn('could not write recovery activity', { leadId, type, error: err.code ?? err.message })
    }
  }

  return {
    /**
     * Something failed. error: { kind, temporary, message, retryAfterSeconds? }.
     * Returns the updated record. NEVER throws: recording a problem must not cause a new one.
     */
    async recordFailure({ kind, targetId, error }) {
      try {
        const label = RECOVERY_KINDS[kind] ?? kind
        const at = now().toISOString()
        const existing = await findOpen(kind, targetId)
        const errorFields = { lastErrorKind: error?.kind ?? 'unknown', lastError: clean(error?.message) || null, updatedAt: at }

        // Already with a person: keep it there (no automatic retries), just note the latest error.
        if (existing?.status === 'escalated') {
          return await store.updateRecovery(existing.id, errorFields)
        }

        // The daily AI quota doesn't count as a try (see retryPolicy.js).
        const counts = error?.kind !== 'quota_exhausted'
        const attempts = (existing?.attempts ?? 0) + (counts ? 1 : 0)
        const decision = decideRetry({ error, failedAttempts: attempts, now: now() })

        const fields = decision.action === 'retry'
          ? { status: 'pending_retry', attempts, nextRetryAt: decision.nextRetryAt, ...errorFields }
          : { status: 'escalated', attempts, nextRetryAt: null, ...errorFields }

        const record = existing
          ? await store.updateRecovery(existing.id, fields)
          : await store.insertRecovery({ id: `RC-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`, kind, targetId, createdAt: at, ...fields })

        if (decision.action === 'retry') {
          await audit('recovery', `${label} of ${targetId} failed (${errorFields.lastErrorKind}). ${decision.reason}`, targetId)
        } else {
          await audit('escalation', `NEEDS A PERSON: ${label} of ${targetId} could not be fixed automatically. ${decision.reason} Last error: ${errorFields.lastError ?? errorFields.lastErrorKind}`, targetId)
        }
        logger.info('recovery recorded', { kind, targetId, action: decision.action, attempts, errorKind: errorFields.lastErrorKind })
        return record
      } catch (err) {
        logger.error('could not record recovery failure', { kind, targetId, error: err.code ?? err.message })
        return null
      }
    },

    /** It worked. Closes an open record, if there is one. Never throws. */
    async recordSuccess({ kind, targetId }) {
      try {
        const existing = await findOpen(kind, targetId)
        if (!existing) return null
        const label = RECOVERY_KINDS[kind] ?? kind
        // While open, `attempts` counts the FAILED tries. The try that just worked counts too, so a recovered
        // record shows the total (e.g. 1 failed + 1 that worked = 2), the same number as the message below.
        // An escalated record keeps its count: a person fixed it, not an automatic try.
        const escalated = existing.status === 'escalated'
        const attempts = escalated ? existing.attempts : existing.attempts + 1
        const record = await store.updateRecovery(existing.id, { status: 'recovered', attempts, nextRetryAt: null, updatedAt: now().toISOString() })
        const how = escalated ? 'after a person stepped in' : `after ${attempts} tries`
        await audit('recovery', `Recovered: ${label} of ${targetId} worked ${how}.`, targetId)
        logger.info('recovery recorded', { kind, targetId, action: 'recovered' })
        return record
      } catch (err) {
        logger.error('could not record recovery success', { kind, targetId, error: err.code ?? err.message })
        return null
      }
    },

    findOpen,

    /** The problem went away by itself (e.g. the lead is no longer Hot). Closes the record. Never throws. */
    async resolve({ kind, targetId, message }) {
      try {
        const existing = await findOpen(kind, targetId)
        if (!existing) return null
        const record = await store.updateRecovery(existing.id, { status: 'recovered', nextRetryAt: null, updatedAt: now().toISOString() })
        await audit('recovery', `Resolved: ${RECOVERY_KINDS[kind] ?? kind} of ${targetId}: ${message}`, targetId)
        return record
      } catch (err) {
        logger.error('could not resolve recovery', { kind, targetId, error: err.code ?? err.message })
        return null
      }
    },

    /** Moves a retry to later without counting a try (e.g. the daily auto-retry budget is used up). */
    async postpone(id, nextRetryAt, reason, targetId) {
      const record = await store.updateRecovery(id, { nextRetryAt, updatedAt: now().toISOString() })
      await audit('recovery', `Retry of ${targetId} postponed: ${reason}`, targetId)
      return record
    },

    /** Escalates without an error from a service (e.g. the lead no longer exists). */
    async escalate(id, reason, targetId) {
      const record = await store.updateRecovery(id, { status: 'escalated', nextRetryAt: null, updatedAt: now().toISOString() })
      await audit('escalation', `NEEDS A PERSON: ${reason}`, targetId)
      return record
    },
  }
}

// ---- The instance the app uses -------------------------------------------------------
let current = createRecoveryService()

export const recovery = () => current

/** TESTS ONLY: replace the recovery service (e.g. with a test store or clock). */
export function useRecoveryForTests(options = {}) {
  current = createRecoveryService(options)
  return current
}
