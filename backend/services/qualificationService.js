// AI lead qualification: the ORCHESTRATION around the Lead Qualification Agent.
// The AI work itself lives in agents/qualificationAgent.js (Stage 5); this file decides
// WHEN it runs and keeps the public API the rest of the app uses:
//
//   start(id)       background: called right after a lead is saved. Never throws, never blocks.
//   requalify(id)   for POST /api/leads/:id/qualify: marks the lead "pending", then runs
//                   in the background too (so the request stays inside the 10s budget).
//   qualifyNow(id)  runs the agent once. Used by start/requalify, and by tests and scripts.
//
// Every run is recorded in AgentRuns (via runAgent). Honest outcomes only:
//   success → classification, score, aiReason, aiModel, qualifiedAt, status "qualified"
//   failure → status "failed", the OLD classification (if any) is kept, and the reason
//             goes to the log, the activity log and AgentRuns. Never a guessed or partial result.
import { AppError } from '../utils/AppError.js'
import { logger as defaultLogger } from '../utils/logger.js'
import { config } from '../config.js'
import * as leadStore from './leadStore.js'
import { AiError, createGeminiClient } from './ai/geminiClient.js'
import { createQualificationAgent } from '../agents/qualificationAgent.js'
import { createToolRegistry } from '../agents/toolRegistry.js'
import { createTools } from '../agents/tools.js'
import { runAgent } from '../agents/runAgent.js'

/**
 * ai:     a Gemini client ({ model, generateJson }), or null when AI is disabled
 * store:  the lead store (findLeadById, updateLead, insertActivity, insertAgentRun)
 * logger, now: injectable for tests
 */
export function createQualificationService({ ai, store = leadStore, logger = defaultLogger, now = () => new Date() }) {
  const running = new Map() // lead ID → promise of the qualification in progress
  const agent = ai ? createQualificationAgent({ ai, now }) : null
  const registry = createToolRegistry(createTools({ store, now }), { logger })
  if (agent) registry.checkAgent(agent) // fail fast if the agent asks for a tool that doesn't exist

  function aiDisabledError() {
    return new AppError(503, 'AI_UNAVAILABLE', 'AI qualification is not configured on this server.')
  }

  /** Runs the agent once. Returns the updated lead. Throws AppError (404, 503 AI_UNAVAILABLE / STORAGE_UNAVAILABLE). */
  async function qualifyNow(id) {
    if (!ai) throw aiDisabledError()
    const outcome = await runAgent({ agent, input: { leadId: id }, registry, store, logger, now })
    if (outcome.ok) return outcome.result.lead
    if (outcome.error instanceof AiError) {
      throw new AppError(503, 'AI_UNAVAILABLE', 'AI qualification failed. The lead was saved and can be qualified again later.')
    }
    throw outcome.error // 404, storage problems (503), permission errors and bugs keep their own meaning
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

    /**
     * Starts qualification in the background (at most one job per lead). Does nothing when AI is
     * disabled (the lead stays "pending"). Returns the job's promise, which resolves to the
     * updated lead, or null if it failed (failures are already logged and recorded). The
     * Orchestrator awaits it; other callers can ignore it.
     */
    start(id) {
      if (!ai) return Promise.resolve(null)
      return runInBackground(id)
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
