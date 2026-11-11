// Runs one agent and records what happened in AgentRuns: which agent, which lead, success or
// failure, how long it took, and why it failed. The Orchestrator (Step 6) uses this for every step.
//
// An agent definition looks like:
//   { name: 'validation', description: '...', tools: ['readLead', ...],
//     async run({ input, tools, logger }) { ... return { status?, summary?, ...data } } }
//
// RULE: `summary` and error messages end up in AgentRuns and the dashboard. Never put
// personal data (names, phones, emails, message text) in them.
import { randomBytes } from 'node:crypto'
import { PermissionError } from './toolRegistry.js'

/**
 * Returns { ok, status, result, error, run, toolCalls }. Never throws for an agent failure:
 * the caller (Orchestrator) decides what to do next.
 *   status: 'success' | 'skipped' (the agent decided there was nothing to do)
 *         | 'failed' | 'denied' (the agent tried to use a tool it may not use)
 */
/**
 * shouldRecord(run): optional. Return false to NOT write this run to AgentRuns (Stage 7: the
 * Recovery Agent's sweep runs every 5 minutes; a sweep that found nothing to do is not worth a
 * spreadsheet row). Failed and denied runs are ALWAYS recorded, whatever it says.
 */
export async function runAgent({ agent, input, registry, store, logger, now = () => new Date(), shouldRecord = () => true }) {
  const startedAt = now().toISOString()
  const started = Date.now()
  const toolCalls = []
  const tools = registry.forAgent(agent, toolCalls)

  let status = 'success'
  let result = null
  let error = null
  let errorKind = null
  let detail = null
  try {
    result = await agent.run({ input, tools, logger })
    status = result?.status === 'skipped' ? 'skipped' : 'success'
    detail = result?.summary ?? null
  } catch (err) {
    error = err
    status = err instanceof PermissionError ? 'denied' : 'failed'
    errorKind = err.kind ?? err.code ?? 'bug'
    detail = String(err.message ?? err).slice(0, 200)
    logger.error('agent run failed', { agent: agent.name, leadId: input?.leadId ?? null, status, errorKind, reason: detail })
  }

  const run = {
    runId: `AR-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
    leadId: input?.leadId ?? null,
    agent: agent.name,
    status,
    durationMs: Date.now() - started,
    errorKind,
    detail,
    startedAt,
  }
  const record = status === 'failed' || status === 'denied' || shouldRecord(run)
  try {
    if (record) await store.insertAgentRun(run)
  } catch (err) {
    // Recording must never hide the real outcome. The store has already logged why it failed.
    logger.warn('could not record agent run', { agent: agent.name, runId: run.runId, error: err.code ?? err.message })
  }

  return { ok: status === 'success' || status === 'skipped', status, result, error, run, toolCalls }
}
