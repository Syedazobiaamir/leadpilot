// RECOVERY AGENT (Stage 7, decision 2A: rules only, no AI, so every decision is predictable,
// free and testable). It runs as a "sweep": n8n's WF5 calls it every 5 minutes (Step 5).
//
// One sweep, in order:
//   AI qualification (only when AI is on):
//   1. STUCK leads: "pending" for more than 10 minutes and nothing running (e.g. the server
//      restarted during the AI call) → open a recovery record
//   2. ADOPT old failures: "failed" leads without a record (failed before Stage 7, or the record
//      could not be saved) → open a record, using the error kind from their last agent run
//   3. RETRY due records: AI qualification again, oldest first, at most MAX_PER_SWEEP per sweep and
//      DAILY_BUDGET per day (decision 4A: the free tier has 20 AI requests/day)
//   n8n hand-offs (only when the backend sends events to n8n):
//   4. STUCK follow-ups:
//        "approved" for 15+ minutes → the event never reached n8n → open a record (safe to hand off
//                                     again: nothing has been sent yet)
//        "sending" for 15+ minutes  → n8n claimed it but never said "sent". It MAY have been
//                                     delivered, so it is NEVER handed off again: escalate (better a
//                                     person checks than the customer gets the same email twice)
//   5. HAND OFF AGAIN due records (lost "followup.approved" / "lead.qualified" events), at most
//      MAX_EVENTS_PER_SWEEP. The event is rebuilt from the CURRENT data, never from a stored copy.
//
// The results are recorded by the normal flows themselves (recoveryService: recovered, retry later,
// or escalated). This agent only decides WHAT to retry and WHEN.
//
// Its tools (below) can read data and start exactly two things: an AI qualification, or a new
// hand-off of an event to n8n. It cannot delete, send emails, edit customer data or touch credentials.
import { logger as defaultLogger } from '../utils/logger.js'
import * as leadStore from '../services/leadStore.js'
import { qualification } from '../services/qualificationService.js'
import { recovery } from '../services/recoveryService.js'
import { automation } from '../services/automationService.js'
import { createToolRegistry } from './toolRegistry.js'
import { runAgent } from './runAgent.js'
import { REVIEW_FLAGS } from './validationAgent.js'

export const STUCK_AFTER_MS = 10 * 60_000 // a lead "pending" for longer than this = stuck
export const STUCK_FOLLOWUP_MS = 15 * 60_000 // a follow-up "approved"/"sending" for longer than this = stuck
export const MAX_PER_SWEEP = 3 // AI retries per sweep (each AI call takes a few seconds)
export const MAX_EVENTS_PER_SWEEP = 5 // event hand-offs per sweep (no AI quota involved)
export const DAILY_BUDGET = 5 // automatic AI retries per day (UTC), decision 4A

// AI error kinds where trying again later can work (same flags as AiError in geminiClient.js).
const TEMPORARY_AI_KINDS = new Set(['timeout', 'rate_limited', 'quota_exhausted', 'unavailable', 'invalid_output'])
const EVENT_KINDS = ['followup_event', 'hot_lead_event']
const OPEN = ['pending_retry', 'escalated']

const TRY_EVENT_PREFIX = 'EV-rc-try-' // one activity event per automatic AI retry (used to count the budget)

/** True if the Validation Agent blocked this lead (test/spam): never spend AI on it. */
export function isBlocked(lead) {
  const flags = String(lead.reviewFlags ?? '').split(',').map((f) => f.trim()).filter(Boolean)
  return flags.some((code) => REVIEW_FLAGS[code]?.severity === 'block')
}

/** Next midnight UTC as an ISO string (when the daily budget starts again). */
function nextUtcMidnight(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString()
}

/** The tools only this agent gets. */
function createRecoveryTools({ store, now, getQualification, getRecovery, getAutomation }) {
  return {
    listLeads: { description: 'List all leads (read-only).', fn: () => store.listLeads() },
    readLead: { description: 'Read one lead (read-only).', fn: (id) => store.findLeadById(id) },
    listFollowUps: { description: 'List all follow-ups (read-only).', fn: () => store.listFollowUps() },
    listRecoveries: { description: 'List recovery records (read-only).', fn: () => store.listRecoveries() },
    lastQualificationRun: {
      description: 'The newest qualification agent run of a lead (read-only), to learn why it failed.',
      fn: async (leadId) =>
        (await store.listAgentRuns())
          .filter((r) => r.leadId === leadId && r.agent === 'qualification')
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null,
    },
    autoRetriesToday: {
      description: 'How many automatic AI retries were started today (UTC), from the activity log (read-only).',
      fn: async () => {
        const today = now().toISOString().slice(0, 10)
        return (await store.listActivity()).filter((e) => e.id.startsWith(TRY_EVENT_PREFIX) && e.timestamp.startsWith(today)).length
      },
    },
    isQualificationRunning: { description: 'Is an AI qualification of this lead running right now?', fn: (id) => getQualification().isRunning(id) },
    openRecoveryRecord: {
      description: 'Open (or update) the recovery record for a problem. The retry policy decides retry vs escalate.',
      fn: (kind, targetId, error) => getRecovery().recordFailure({ kind, targetId, error }),
    },
    closeRecoveryRecord: { description: 'Mark a record recovered (it already works).', fn: (kind, targetId) => getRecovery().recordSuccess({ kind, targetId }) },
    resolveRecovery: { description: 'Close a record whose problem went away by itself.', fn: (kind, targetId, message) => getRecovery().resolve({ kind, targetId, message }) },
    postponeRecovery: { description: 'Move a due retry to later, without counting a try.', fn: (id, at, reason, targetId) => getRecovery().postpone(id, at, reason, targetId) },
    escalateRecovery: { description: 'Hand a record to a person (no more automatic retries).', fn: (id, reason, targetId) => getRecovery().escalate(id, reason, targetId) },
    retryQualification: {
      description: 'Run the AI qualification of ONE lead again. Uses 1 AI request.',
      fn: async (leadId, attemptNo) => {
        // Count it BEFORE calling the AI, so a crash can never make us exceed the daily budget.
        await store.insertActivity({
          id: `${TRY_EVENT_PREFIX}${Date.now()}-${leadId}`, type: 'recovery',
          message: `Automatic retry ${attemptNo}: AI qualification of ${leadId}`, leadId, timestamp: now().toISOString(),
        })
        try {
          await getQualification().qualifyNow(leadId)
          return { ok: true }
        } catch (err) {
          return { ok: false, code: err.code ?? 'error' } // already recorded by the qualification flow
        }
      },
    },
    retryHandOff: {
      description: 'Hand ONE event to n8n again, rebuilt from the current data. n8n decides what to do with it.',
      fn: async (kind, payload) => {
        const n8n = getAutomation()
        const result = kind === 'followup_event' ? await n8n.notifyFollowUpApproved(payload) : await n8n.notifyLeadQualified(payload)
        return { ok: Boolean(result) } // the outcome is recorded by the automation flow itself
      },
    },
  }
}

export const recoveryAgentDefinition = {
  name: 'recovery',
  description: 'Finds failed or stuck AI qualifications and n8n hand-offs, retries them within limits, and escalates what it cannot fix. Rules only, no AI.',
  tools: ['listLeads', 'readLead', 'listFollowUps', 'listRecoveries', 'lastQualificationRun', 'autoRetriesToday', 'isQualificationRunning',
    'openRecoveryRecord', 'closeRecoveryRecord', 'resolveRecovery', 'postponeRecovery', 'escalateRecovery', 'retryQualification', 'retryHandOff'],
}

/**
 * Builds the agent and a `sweep()` that runs it once (never two sweeps at the same time).
 * getQualification / getRecovery / getAutomation: functions returning the CURRENT services (tests swap them).
 */
export function createRecoverySweep({
  store = leadStore, logger = defaultLogger, now = () => new Date(),
  getQualification = qualification, getRecovery = recovery, getAutomation = automation,
  maxPerSweep = MAX_PER_SWEEP, maxEventsPerSweep = MAX_EVENTS_PER_SWEEP, dailyBudget = DAILY_BUDGET,
} = {}) {
  const registry = createToolRegistry(createRecoveryTools({ store, now, getQualification, getRecovery, getAutomation }), { logger })

  /** Steps 1-3: AI qualification. */
  async function recoverQualifications(tools, counts, nowMs) {
    const leads = await tools.call('listLeads')
    const records = await tools.call('listRecoveries')
    const hasOpen = (leadId) => records.some((r) => r.kind === 'qualification' && r.targetId === leadId && OPEN.includes(r.status))

    for (const lead of leads) {
      if (isBlocked(lead) || hasOpen(lead.id) || (await tools.call('isQualificationRunning', lead.id))) continue
      if (lead.qualificationStatus === 'pending' && nowMs - Date.parse(lead.createdAt) > STUCK_AFTER_MS) {
        await tools.call('openRecoveryRecord', 'qualification', lead.id, { kind: 'stuck_pending', temporary: true, message: 'Still "pending" after 10 minutes (the server may have stopped during the AI call).' })
        counts.stuck++
      } else if (lead.qualificationStatus === 'failed') {
        const run = await tools.call('lastQualificationRun', lead.id)
        const kind = run?.errorKind ?? 'unknown'
        await tools.call('openRecoveryRecord', 'qualification', lead.id, { kind, temporary: TEMPORARY_AI_KINDS.has(kind), message: run?.detail ?? 'Failed before automatic recovery existed; reason unknown.' })
        counts.adopted++
      }
    }

    const due = (await tools.call('listRecoveries'))
      .filter((r) => r.kind === 'qualification' && r.status === 'pending_retry' && r.nextRetryAt && Date.parse(r.nextRetryAt) <= nowMs)
      .sort((a, b) => a.nextRetryAt.localeCompare(b.nextRetryAt))

    let used = await tools.call('autoRetriesToday')
    for (const record of due) {
      if (counts.retried >= maxPerSweep) break // the rest waits for the next sweep
      const lead = await tools.call('readLead', record.targetId)
      if (!lead) {
        await tools.call('escalateRecovery', record.id, `${record.targetId} no longer exists, so it cannot be retried.`, record.targetId)
        counts.escalated++
        continue
      }
      if (lead.qualificationStatus === 'qualified') {
        await tools.call('closeRecoveryRecord', 'qualification', record.targetId) // someone (or something) already fixed it
        counts.recovered++
        continue
      }
      if (isBlocked(lead)) {
        await tools.call('escalateRecovery', record.id, `${record.targetId} was flagged by the Validation Agent (test/spam). No AI is spent on it; a person decides.`, record.targetId)
        counts.escalated++
        continue
      }
      if (await tools.call('isQualificationRunning', record.targetId)) continue
      if (used >= dailyBudget) {
        await tools.call('postponeRecovery', record.id, nextUtcMidnight(now()), `the daily limit of ${dailyBudget} automatic AI retries is used up (protects the free AI quota).`, record.targetId)
        counts.postponed++
        continue
      }
      used++
      counts.retried++
      const result = await tools.call('retryQualification', record.targetId, record.attempts + 1)
      if (result.ok) counts.recovered++
      else counts.stillFailing++
    }
  }

  /** Steps 4-5: n8n hand-offs. */
  async function recoverHandOffs(tools, counts, nowMs) {
    const followUps = await tools.call('listFollowUps')
    const records = await tools.call('listRecoveries')
    const hasOpen = (kind, id) => records.some((r) => r.kind === kind && r.targetId === id && OPEN.includes(r.status))
    const olderThan = (iso, ms) => Boolean(iso) && nowMs - Date.parse(iso) > ms

    for (const f of followUps) {
      if (f.status === 'approved' && olderThan(f.decidedAt, STUCK_FOLLOWUP_MS) && !hasOpen('followup_event', f.id)) {
        await tools.call('openRecoveryRecord', 'followup_event', f.id, { kind: 'not_handed_off', temporary: true, message: 'Approved 15+ minutes ago, but n8n never picked it up.' })
        counts.stuckFollowUps++
      } else if (f.status === 'sending' && olderThan(f.claimedAt, STUCK_FOLLOWUP_MS) && !hasOpen('followup_delivery', f.id)) {
        // NOT temporary on purpose: it may already have been delivered. A person checks first.
        await tools.call('openRecoveryRecord', 'followup_delivery', f.id, {
          kind: 'stuck_sending', temporary: false,
          message: `Claimed by n8n run #${f.claimedBy ?? '?'} 15+ minutes ago but never marked sent. It MAY have been delivered: check before sending it again.`,
        })
        counts.stuckFollowUps++
      }
    }

    const due = (await tools.call('listRecoveries'))
      .filter((r) => EVENT_KINDS.includes(r.kind) && r.status === 'pending_retry' && r.nextRetryAt && Date.parse(r.nextRetryAt) <= nowMs)
      .sort((a, b) => a.nextRetryAt.localeCompare(b.nextRetryAt))

    for (const record of due) {
      if (counts.handOffs >= maxEventsPerSweep) break
      if (record.kind === 'followup_event') {
        const f = followUps.find((x) => x.id === record.targetId)
        if (!f) {
          await tools.call('escalateRecovery', record.id, `Follow-up ${record.targetId} no longer exists.`, record.targetId)
          counts.escalated++
          continue
        }
        if (f.status === 'sending' || f.status === 'sent') {
          await tools.call('resolveRecovery', 'followup_event', f.id, `n8n has it already (status "${f.status}").`)
          counts.handOffsResolved++
          continue
        }
        if (f.status !== 'approved') {
          await tools.call('escalateRecovery', record.id, `Follow-up ${f.id} is "${f.status}", not approved: it is not handed to n8n.`, f.id)
          counts.escalated++
          continue
        }
        counts.handOffs++
        if ((await tools.call('retryHandOff', 'followup_event', f)).ok) counts.handOffsDelivered++
      } else {
        const lead = await tools.call('readLead', record.targetId)
        if (!lead) {
          await tools.call('escalateRecovery', record.id, `${record.targetId} no longer exists.`, record.targetId)
          counts.escalated++
          continue
        }
        if (lead.classification !== 'Hot') {
          await tools.call('resolveRecovery', 'hot_lead_event', lead.id, `the lead is no longer Hot (${lead.classification ?? 'unclassified'}), so no alert is needed.`)
          counts.handOffsResolved++
          continue
        }
        counts.handOffs++
        if ((await tools.call('retryHandOff', 'hot_lead_event', lead)).ok) counts.handOffsDelivered++
      }
    }
  }

  const agent = {
    ...recoveryAgentDefinition,
    async run({ tools }) {
      const counts = {
        stuck: 0, adopted: 0, retried: 0, recovered: 0, stillFailing: 0, postponed: 0, escalated: 0,
        stuckFollowUps: 0, handOffs: 0, handOffsDelivered: 0, handOffsResolved: 0,
      }
      const aiOn = getQualification().enabled
      const n8nOn = getAutomation().outboundEnabled
      if (!aiOn && !n8nOn) return { status: 'skipped', counts, summary: 'AI and n8n are both off: nothing to recover' }

      const nowMs = now().getTime()
      if (aiOn) await recoverQualifications(tools, counts, nowMs)
      if (n8nOn) await recoverHandOffs(tools, counts, nowMs)

      const summary = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing to do'
      return { status: 'success', counts, summary: `${summary}${aiOn ? '' : ' (AI off)'}${n8nOn ? '' : ' (n8n off)'}` }
    },
  }
  registry.checkAgent(agent)

  let inFlight = null
  return {
    agent,
    /** Runs one sweep. If one is already running, returns that one instead of starting a second. */
    sweep() {
      if (inFlight) return inFlight
      // A sweep that found nothing to do is not written to AgentRuns (it runs 288 times a day).
      const shouldRecord = (run) => !String(run.detail ?? '').startsWith('nothing to do')
      inFlight = runAgent({ agent, input: {}, registry, store, logger, now, shouldRecord })
        .then((outcome) => ({ ok: outcome.ok, status: outcome.status, counts: outcome.result?.counts ?? null, summary: outcome.run.detail, runId: outcome.run.runId }))
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },
  }
}

// ---- The instance the app uses -------------------------------------------------------
let current = createRecoverySweep()

export const recoverySweep = () => current

/** TESTS ONLY: replace the sweep (e.g. with a test store, clock or limits). */
export function useRecoverySweepForTests(options = {}) {
  current = createRecoverySweep(options)
  return current
}
