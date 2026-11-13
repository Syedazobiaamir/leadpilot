// LEAD MANAGEMENT ORCHESTRATOR (Stage 5, decision 1A: code-driven, not an AI).
//
// Runs the agents for a NEW lead, always in the same order:
//   1. Validation Agent      → blocked (test/spam)? stop here: no AI quota is spent
//   2. Qualification Agent   → Hot / Warm / Cold (AI). Failed? stop here (the lead can be retried)
//   3. Follow-up Agent       → only for Hot leads (decision 2A): writes a DRAFT that needs approval
//
// The Orchestrator has NO tools: it never touches data itself, it only calls the agents
// (each of which has its own limited tools). Every agent run is recorded in AgentRuns, and the
// Orchestrator records one more run with a one-line summary of the whole pipeline, e.g.
//   "validation: ok → qualification: Hot 95 → followup: draft FU-..."
import { logger as defaultLogger } from '../utils/logger.js'
import { keepAlive } from '../utils/background.js'
import * as leadStore from '../services/leadStore.js'
import { qualification } from '../services/qualificationService.js'
import { followUps } from '../services/followUpService.js'
import { createToolRegistry } from './toolRegistry.js'
import { createTools } from './tools.js'
import { runAgent } from './runAgent.js'
import { validationAgent } from './validationAgent.js'

/**
 * getQualification / getFollowUps: functions returning the CURRENT services (so tests can swap them).
 * autoFollowUpFor: which classes get an automatic follow-up draft.
 */
export function createOrchestrator({
  store = leadStore,
  logger = defaultLogger,
  now = () => new Date(),
  getQualification = qualification,
  getFollowUps = followUps,
  autoFollowUpFor = ['Hot'],
} = {}) {
  const registry = createToolRegistry(createTools({ store, now }), { logger })
  registry.checkAgent(validationAgent)
  const running = new Map() // lead ID → pipeline promise

  const orchestratorAgent = {
    name: 'orchestrator',
    description: 'Runs validation → qualification → follow-up (Hot only) for a new lead. Has no tools of its own.',
    tools: [],

    async run({ input }) {
      const leadId = input.leadId
      const steps = []
      const done = (stoppedAt) => ({ steps, stoppedAt, summary: steps.join(' → ') })

      // 1. Validation (rules, no AI)
      const validation = await runAgent({ agent: validationAgent, input: { leadId }, registry, store, logger, now })
      if (!validation.ok) {
        // A validation failure (e.g. storage) is not a reason to skip the customer: carry on.
        steps.push(`validation: ${validation.status}`)
      } else {
        const { flags, blocked } = validation.result
        steps.push(`validation: ${blocked ? 'blocked' : flags.length > 0 ? `review (${flags.join(', ')})` : 'ok'}`)
        if (blocked) {
          steps.push('qualification: skipped (blocked lead, no AI used)')
          return done('validation')
        }
      }

      // 2. Qualification (AI)
      const qualifier = getQualification()
      if (!qualifier.enabled) {
        steps.push('qualification: skipped (AI disabled)')
        return done('qualification')
      }
      const lead = await qualifier.start(leadId) // the updated lead, or null if it failed
      if (!lead) {
        steps.push('qualification: failed (see its run)')
        return done('qualification')
      }
      steps.push(`qualification: ${lead.classification} ${lead.score}`)

      // 3. Follow-up draft (AI), Hot leads only
      if (!autoFollowUpFor.includes(lead.classification)) {
        steps.push('followup: not automatic for this class')
        return done(null)
      }
      const writer = getFollowUps()
      if (!writer.enabled) {
        steps.push('followup: skipped (AI disabled)')
        return done('followup')
      }
      const draft = await writer.start(leadId) // the draft, or null (skipped/failed, see its run)
      steps.push(draft ? `followup: draft ${draft.id}` : 'followup: no new draft (see its run)')
      return done(null)
    },
  }

  return {
    agent: orchestratorAgent,

    /** Runs the whole pipeline for a lead in the background (at most once per lead at a time). */
    start(leadId) {
      if (running.has(leadId)) return running.get(leadId)
      const job = runAgent({ agent: orchestratorAgent, input: { leadId }, registry, store, logger, now })
        .then((outcome) => outcome.result)
        .finally(() => running.delete(leadId))
      running.set(leadId, job)
      return keepAlive(job) // Stage 9: on Vercel, keep the function alive until the whole pipeline is done
    },

    /** Resolves when no pipeline (and no agent job it started) is running. For tests and scripts. */
    async whenIdle() {
      while (running.size > 0) await Promise.all([...running.values()])
      await getQualification().whenIdle()
      await getFollowUps().whenIdle()
    },
  }
}

// ---- The instance the app uses -------------------------------------------------------
let current = createOrchestrator()

export const orchestrator = () => current

/** TESTS ONLY: replace the orchestrator (e.g. with a different store or settings). */
export function useOrchestratorForTests(options = {}) {
  current = createOrchestrator(options)
  return current
}
