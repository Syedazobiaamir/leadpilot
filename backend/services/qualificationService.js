// AI lead qualification: lead → AI → validate → save.
// (In Stage 5 this becomes the "Lead Qualification Agent".)
//
//   start(id)       background: called right after a lead is saved. Never throws, never blocks.
//   requalify(id)   for POST /api/leads/:id/qualify: marks the lead "pending", then runs
//                   in the background too (so the request stays inside the 10s budget).
//   qualifyNow(id)  the actual work. Used by start/requalify, and by tests and scripts.
//
// Honest outcomes only:
//   success → classification, score, aiReason, aiModel, qualifiedAt, status "qualified"
//   failure → status "failed", the OLD classification (if any) is kept, and the reason
//             goes to the log and the activity log. Never a guessed or partial result.
import { AppError } from '../utils/AppError.js'
import { logger as defaultLogger } from '../utils/logger.js'
import { config } from '../config.js'
import * as leadStore from './leadStore.js'
import { AiError, createGeminiClient } from './ai/geminiClient.js'
import {
  QUALIFICATION_SETTINGS,
  RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTIONS,
  buildQualificationPrompt,
  qualificationResultSchema,
} from './ai/qualificationPrompt.js'

/**
 * ai:     a Gemini client ({ model, generateJson }), or null when AI is disabled
 * store:  the lead store (findLeadById, updateLead, insertActivity)
 * logger, now: injectable for tests
 */
export function createQualificationService({ ai, store = leadStore, logger = defaultLogger, now = () => new Date() }) {
  const running = new Map() // lead ID → promise of the qualification in progress

  function aiDisabledError() {
    return new AppError(503, 'AI_UNAVAILABLE', 'AI qualification is not configured on this server.')
  }

  async function audit(type, message, leadId) {
    try {
      await store.insertActivity({ id: `EV-${Date.now()}-${leadId}-${type}`, type, message, leadId, timestamp: now().toISOString() })
    } catch (err) {
      // An audit write failing must not hide the real outcome. The store has already logged why.
      logger.warn('could not write activity event', { leadId, type, error: err.code ?? err.message })
    }
  }

  /** Asks the AI and returns a VALIDATED result, or throws an AiError. */
  async function askAi(lead) {
    const { data, model } = await ai.generateJson({
      system: SYSTEM_INSTRUCTIONS,
      prompt: buildQualificationPrompt(lead),
      schema: RESPONSE_SCHEMA,
      ...QUALIFICATION_SETTINGS,
    })
    const parsed = qualificationResultSchema.safeParse(data)
    if (!parsed.success) {
      // Log what was wrong (field names and rules only, never the customer's message).
      const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(answer)'}: ${i.message}`)
      logger.warn('ai answer rejected', { leadId: lead.id, model, problems })
      throw new AiError('invalid_output', `The AI answer did not pass validation (${problems.join('; ')}).`, { temporary: true })
    }
    return { ...parsed.data, model }
  }

  /** Does the work. Returns the updated lead. Throws AppError (404, 503 AI_UNAVAILABLE / STORAGE_UNAVAILABLE). */
  async function qualifyNow(id) {
    if (!ai) throw aiDisabledError()
    const lead = await store.findLeadById(id)
    if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', `No lead found with ID ${id}`)

    let result
    try {
      result = await askAi(lead)
    } catch (err) {
      if (!(err instanceof AiError)) throw err // a bug: let it surface as a 500
      logger.error('ai qualification failed', {
        leadId: id, kind: err.kind, temporary: err.temporary, reason: err.message,
        httpStatus: err.httpStatus, apiStatus: err.apiStatus, retryAfterSeconds: err.retryAfterSeconds, model: ai.model,
      })
      await store.updateLead(id, { qualificationStatus: 'failed' })
      await audit('error', `AI qualification failed for ${id}: ${err.message} (${err.temporary ? 'temporary, can be retried' : 'needs attention'})`, id)
      throw new AppError(503, 'AI_UNAVAILABLE', 'AI qualification failed. The lead was saved and can be qualified again later.')
    }

    const updated = await store.updateLead(id, {
      classification: result.classification,
      score: result.score,
      aiReason: result.reason,
      aiModel: result.model,
      qualificationStatus: 'qualified',
      qualifiedAt: now().toISOString(),
    })
    logger.info('lead qualified', { leadId: id, classification: result.classification, score: result.score, model: result.model, injectionSuspected: result.injectionSuspected })
    await audit('ai', `${id} classified as ${result.classification} (score ${result.score}) by ${result.model}`, id)
    if (result.injectionSuspected) {
      // Security audit trail: someone may have tried to manipulate the AI through the form.
      await audit('error', `Possible prompt injection in ${id}: the inquiry contained instructions to the AI. They were ignored.`, id)
    }
    return updated
  }

  /** Runs qualifyNow in the background, at most once per lead at a time. Returns the promise. */
  function runInBackground(id) {
    if (running.has(id)) return running.get(id) // already in progress: don't call the AI twice
    const job = qualifyNow(id)
      .catch((err) => {
        // Already logged in detail above. This only catches failures OUTSIDE the AI call (e.g. storage).
        if (err?.code !== 'AI_UNAVAILABLE') logger.error('background qualification error', { leadId: id, code: err?.code, error: err?.message })
        return null
      })
      .finally(() => running.delete(id))
    running.set(id, job)
    return job
  }

  return {
    enabled: Boolean(ai),
    model: ai?.model ?? null,

    qualifyNow,

    /** After a new lead is saved. Does nothing when AI is disabled (the lead stays "pending"). */
    start(id) {
      if (!ai) return
      runInBackground(id)
    },

    /** Manual (re)qualification: mark "pending" now, run in the background. Returns the pending lead. */
    async requalify(id) {
      if (!ai) throw aiDisabledError()
      if (running.has(id)) return store.findLeadById(id) // already running: nothing new to start
      const pending = await store.updateLead(id, { qualificationStatus: 'pending' })
      if (!pending) throw new AppError(404, 'LEAD_NOT_FOUND', `No lead found with ID ${id}`)
      runInBackground(id)
      return pending
    },

    /** Resolves when no qualification is running (used by tests and graceful scripts). */
    async whenIdle() {
      while (running.size > 0) await Promise.all([...running.values()])
    },
  }
}

// ---- The instance the app uses -------------------------------------------------------
let current = createQualificationService({
  ai: config.ai ? createGeminiClient({ ...config.ai, timeoutMs: config.aiTimeoutMs }) : null,
})

/** The active qualification service. */
export const qualification = () => current

/**
 * TESTS ONLY: replace the AI client (e.g. with a fake) or pass null to disable AI.
 * Returns the new service. Real code never calls this.
 */
export function useAiClientForTests(ai, options = {}) {
  current = createQualificationService({ ai, ...options })
  return current
}
