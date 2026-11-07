// Follow-up drafts: AI writes (Follow-up Agent, in the background), PEOPLE decide.
//
//   requestDraft(leadId)  POST /api/leads/:id/followups → 202, the agent writes a draft in the background
//   listForLead(leadId)   GET  /api/leads/:id/followups
//   approve(id) / reject(id) / edit(id, {subject, body})   human decisions on a draft
//   start(leadId)         background, for the Orchestrator (Step 6)
//
// Draft life cycle:  draft ──approve──► approved   (Stage 6: n8n sends approved drafts)
//                      │  └──reject───► rejected
//                      └─edit─► draft (editedAt set)
// Once approved or rejected, a follow-up can no longer change (409).
// Nothing in this file sends any message.
import { AppError } from '../utils/AppError.js'
import { logger as defaultLogger } from '../utils/logger.js'
import { config } from '../config.js'
import * as leadStore from './leadStore.js'
import { AiError, createGeminiClient } from './ai/geminiClient.js'
import { editedDraftSchema } from './ai/followUpPrompt.js'
import { createFollowUpAgent } from '../agents/followUpAgent.js'
import { createToolRegistry } from '../agents/toolRegistry.js'
import { createTools } from '../agents/tools.js'
import { runAgent } from '../agents/runAgent.js'

const FOLLOW_UP_ID = /^FU-[A-Za-z0-9-]{1,40}$/

export function createFollowUpService({ ai, store = leadStore, logger = defaultLogger, now = () => new Date(), contractorName = config.contractorName }) {
  const running = new Map() // lead ID → promise of the draft being written
  const agent = ai ? createFollowUpAgent({ ai, contractorName, now }) : null
  const registry = createToolRegistry(createTools({ store, now }), { logger })
  if (agent) registry.checkAgent(agent)

  const aiDisabled = () => new AppError(503, 'AI_UNAVAILABLE', 'AI is not configured on this server, so follow-up drafts cannot be written.')

  async function requireLead(leadId) {
    const lead = await store.findLeadById(leadId)
    if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', `No lead found with ID ${leadId}`)
    return lead
  }

  async function requireDraft(id) {
    if (!FOLLOW_UP_ID.test(id)) throw new AppError(400, 'INVALID_FOLLOWUP_ID', 'Follow-up ID must look like FU-...')
    const followUp = (await store.listFollowUps()).find((f) => f.id === id)
    if (!followUp) throw new AppError(404, 'FOLLOWUP_NOT_FOUND', `No follow-up found with ID ${id}`)
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
    return job
  }

  async function decide(id, status, verb) {
    const followUp = await requireDraft(id)
    const updated = await store.updateFollowUp(id, { status, decidedAt: now().toISOString() })
    await audit('automation', `Follow-up ${id} ${verb} by staff${status === 'approved' ? ' (not sent: sending arrives in Stage 6)' : ''}`, followUp.leadId)
    return updated
  }

  return {
    enabled: Boolean(ai),
    generateNow,

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
