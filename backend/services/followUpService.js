// Follow-up drafts: AI writes (Follow-up Agent, in the background), PEOPLE decide.
//
//   requestDraft(leadId)  POST /api/leads/:id/followups → 202, the agent writes a draft in the background
//   listForLead(leadId)   GET  /api/leads/:id/followups
//   approve(id) / reject(id) / edit(id, {subject, body})   human decisions on a draft
//   start(leadId)         background, for the Orchestrator (Step 6)
//   claim(id, {executionId})  Stage 7: n8n takes an approved follow-up for sending ("sending")
//   markSent(id, {via})       Stage 6: n8n reports it sent it
//
// Life cycle:  draft ──approve──► approved ──claim──► sending ──mark-sent──► sent
// "sending" is a lock: once one n8n run has claimed a follow-up, no other run can send it, so a
// duplicate event can never send the customer the same email twice.
//                │  └──reject───► rejected
//                └─edit─► draft (editedAt set)
// Once approved or rejected, a PERSON can no longer change it (409).
// Approving hands the follow-up to n8n (event "followup.approved"). Nothing in this file
// sends a message itself. In Stage 6 n8n's sending is SIMULATED (decision D2A).
import { z } from 'zod'
import { AppError } from '../utils/AppError.js'
import { logger as defaultLogger } from '../utils/logger.js'
import { keepAlive } from '../utils/background.js'
import { config } from '../config.js'
import * as leadStore from './leadStore.js'
import { AiError, createGeminiClient } from './ai/geminiClient.js'
import { editedDraftSchema } from './ai/followUpPrompt.js'
import { createFollowUpAgent } from '../agents/followUpAgent.js'
import { createToolRegistry } from '../agents/toolRegistry.js'
import { createTools } from '../agents/tools.js'
import { runAgent } from '../agents/runAgent.js'
import { automation } from './automationService.js'

const FOLLOW_UP_ID = /^FU-[A-Za-z0-9-]{1,40}$/

// How n8n may say it sent a follow-up. Only "simulated" exists in Stage 6 (no real email).
const markSentSchema = z.object({ via: z.enum(['simulated']) })
// Which n8n run claims a follow-up (its execution ID), so a retried claim by the SAME run still works.
const claimSchema = z.object({ executionId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) })

/** getAutomation: returns the CURRENT automation service (so tests can swap it). */
export function createFollowUpService({ ai, store = leadStore, logger = defaultLogger, now = () => new Date(), contractorName = config.contractorName, getAutomation = automation }) {
  const running = new Map() // lead ID → promise of the draft being written
  const locks = new Map() // follow-up ID → claim/mark-sent in progress (so two calls can't both write)

  /** Runs `work` for one follow-up at a time: a second call waits for the first, then runs. */
  function oneAtATime(id, work) {
    const previous = locks.get(id) ?? Promise.resolve()
    const job = previous.catch(() => {}).then(work)
    const tail = job.catch(() => {})
    locks.set(id, tail)
    tail.then(() => {
      if (locks.get(id) === tail) locks.delete(id)
    })
    return job
  }
  const agent = ai ? createFollowUpAgent({ ai, contractorName, now }) : null
  const registry = createToolRegistry(createTools({ store, now }), { logger })
  if (agent) registry.checkAgent(agent)

  const aiDisabled = () => new AppError(503, 'AI_UNAVAILABLE', 'AI is not configured on this server, so follow-up drafts cannot be written.')

  async function requireLead(leadId) {
    const lead = await store.findLeadById(leadId)
    if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', `No lead found with ID ${leadId}`)
    return lead
  }

  async function requireFollowUp(id) {
    if (!FOLLOW_UP_ID.test(id)) throw new AppError(400, 'INVALID_FOLLOWUP_ID', 'Follow-up ID must look like FU-...')
    const followUp = (await store.listFollowUps()).find((f) => f.id === id)
    if (!followUp) throw new AppError(404, 'FOLLOWUP_NOT_FOUND', `No follow-up found with ID ${id}`)
    return followUp
  }

  async function requireDraft(id) {
    const followUp = await requireFollowUp(id)
    if (followUp.status !== 'draft') {
      throw new AppError(409, 'FOLLOWUP_ALREADY_DECIDED', `Follow-up ${id} is already ${followUp.status} and can no longer be changed`)
    }
    return followUp
  }

  async function audit(type, message, leadId) {
    try {
      await store.insertActivity({ id: `EV-${Date.now()}-${leadId}-${type}`, type, message, leadId, timestamp: now().toISOString() })
    } catch (err) {
      logger.warn('could not write activity event', { leadId, type, error: err.code ?? err.message })
    }
  }

  /** Runs the agent once. Returns the new draft, or null if skipped (an open draft exists). */
  async function generateNow(leadId) {
    if (!ai) throw aiDisabled()
    const outcome = await runAgent({ agent, input: { leadId }, registry, store, logger, now })
    if (outcome.ok) return outcome.result?.followUp ?? null
    if (outcome.error instanceof AiError) {
      throw new AppError(503, 'AI_UNAVAILABLE', 'The AI could not write a follow-up draft. Try again later.')
    }
    throw outcome.error
  }

  function runInBackground(leadId) {
    if (running.has(leadId)) return running.get(leadId) // at most one draft job per lead
    const job = generateNow(leadId)
      .catch((err) => {
        if (err?.code !== 'AI_UNAVAILABLE') logger.error('background follow-up error', { leadId, code: err?.code, error: err?.message })
        return null
      })
      .finally(() => running.delete(leadId))
    running.set(leadId, job)
    return keepAlive(job) // Stage 9: on Vercel, keep the function alive until the draft is saved
  }

  async function decide(id, status, verb) {
    const followUp = await requireDraft(id)
    const updated = await store.updateFollowUp(id, { status, decidedAt: now().toISOString() })
    let note = ''
    if (status === 'approved') {
      const n8n = getAutomation()
      // Background: the person gets their answer now, n8n's result shows up as a workflow run.
      if (n8n.outboundEnabled) n8n.notifyFollowUpApproved(updated)
      note = n8n.outboundEnabled ? ' (handed to n8n for SIMULATED sending)' : ' (not sent: n8n automation is off)'
    }
    await audit('automation', `Follow-up ${id} ${verb} by staff${note}`, followUp.leadId)
    return updated
  }

  /**
   * n8n says it sent an approved follow-up. IDEMPOTENT: calling it again (e.g. n8n retried
   * after a timeout) returns the same result and changes nothing, so a follow-up can never be
   * recorded as sent twice. Returns { followUp, alreadySent }.
   */
  async function markSentOnce(id, input) {
    const parsed = markSentSchema.safeParse(input ?? {})
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'The mark-sent request is invalid', { via: 'via must be "simulated"' })
    }
    const followUp = await requireFollowUp(id)
    if (followUp.status === 'sent') return { followUp, alreadySent: true }
    if (followUp.status !== 'sending') {
      // Stage 7: it must be CLAIMED first (approved → sending), so only one run can send it.
      throw new AppError(409, 'FOLLOWUP_NOT_CLAIMED', `Follow-up ${id} is ${followUp.status}: it must be claimed ("sending") before it can be marked sent`)
    }
    const updated = await store.updateFollowUp(id, { status: 'sent', sentAt: now().toISOString(), sentVia: parsed.data.via })
    await audit('automation', `Follow-up ${id} sent by n8n (SIMULATED: no real message left the system)`, followUp.leadId)
    return { followUp: updated, alreadySent: false }
  }

  /**
   * n8n wants to send an approved follow-up. Returns { followUp, claimed }:
   *   approved                      → becomes "sending", claimed: true  → deliver it
   *   sending, claimed by THIS run  → claimed: true (the same run retried its claim)
   *   sending (another run) or sent → claimed: false → do NOT deliver (duplicate)
   *   draft / rejected              → 409 FOLLOWUP_NOT_APPROVED
   */
  async function claimOnce(id, input) {
    const parsed = claimSchema.safeParse(input ?? {})
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'The claim request is invalid', { executionId: 'executionId must be 1-40 letters, digits, "-" or "_"' })
    const { executionId } = parsed.data
    const followUp = await requireFollowUp(id)
    if (followUp.status === 'sending' && followUp.claimedBy === executionId) return { followUp, claimed: true }
    if (followUp.status === 'sending' || followUp.status === 'sent') return { followUp, claimed: false }
    if (followUp.status !== 'approved') {
      throw new AppError(409, 'FOLLOWUP_NOT_APPROVED', `Follow-up ${id} is ${followUp.status}, only approved follow-ups can be sent`)
    }
    const updated = await store.updateFollowUp(id, { status: 'sending', claimedAt: now().toISOString(), claimedBy: executionId })
    await audit('automation', `Follow-up ${id} claimed for sending by n8n run #${executionId}`, followUp.leadId)
    return { followUp: updated, claimed: true }
  }

  return {
    enabled: Boolean(ai),
    generateNow,

    /** Stage 7: n8n claims an approved follow-up before sending it (one claim/mark-sent at a time per ID). */
    claim: (id, input) => oneAtATime(id, () => claimOnce(id, input)),

    /**
     * For the Orchestrator: start a draft in the background. Does nothing when AI is disabled.
     * Returns the job's promise: the new draft, or null (skipped or failed; both are recorded).
     */
    start(leadId) {
      if (!ai) return Promise.resolve(null)
      return runInBackground(leadId)
    },

    async requestDraft(leadId) {
      if (!ai) throw aiDisabled()
      await requireLead(leadId)
      runInBackground(leadId)
      return { leadId, status: 'generating' }
    },

    async listForLead(leadId) {
      await requireLead(leadId)
      return (await store.listFollowUps()).filter((f) => f.leadId === leadId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    approve: (id) => decide(id, 'approved', 'approved'),

    /**
     * For n8n, BEFORE it delivers: is this follow-up still approved (and not sent yet)?
     * Returns only what n8n needs to decide, not the message or any customer data.
     */
    async deliveryStatus(id) {
      const { leadId, status, sentAt } = await requireFollowUp(id)
      return { id, leadId, status, sentAt: sentAt ?? null }
    },

    /** Mark-sent calls for the same ID run one after the other (the second sees "sent"). */
    markSent: (id, input) => oneAtATime(id, () => markSentOnce(id, input)),
    reject: (id) => decide(id, 'rejected', 'rejected'),

    async edit(id, input) {
      const parsed = editedDraftSchema.safeParse(input ?? {})
      if (!parsed.success) {
        const details = {}
        for (const issue of parsed.error.issues) details[issue.path[0] ?? 'body'] ??= issue.message
        throw new AppError(400, 'VALIDATION_ERROR', 'The edited follow-up is invalid', details)
      }
      const followUp = await requireDraft(id)
      const updated = await store.updateFollowUp(id, { ...parsed.data, editedAt: now().toISOString() })
      await audit('automation', `Follow-up ${id} edited by staff`, followUp.leadId)
      return updated
    },

    async whenIdle() {
      while (running.size > 0) await Promise.all([...running.values()])
    },
  }
}

// ---- The instance the app uses -------------------------------------------------------
let current = createFollowUpService({
  ai: config.ai ? createGeminiClient({ ...config.ai, timeoutMs: config.aiTimeoutMs }) : null,
})

export const followUps = () => current

/** TESTS ONLY: replace the AI client (e.g. with a fake), or pass null to disable AI. */
export function useFollowUpAiForTests(ai, options = {}) {
  current = createFollowUpService({ ai, ...options })
  return current
}
