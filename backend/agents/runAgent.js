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
export async function runAgent({ agent, input, registry, store, logger, now = () => new Date() }) {
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
  try {
    await store.insertAgentRun(run)
  } catch (err) {
    // Recording must never hide the real outcome. The store has already logged why it failed.
    logger.warn('could not record agent run', { agent: agent.name, runId: run.runId, error: err.code ?? err.message })
  }

  return { ok: status === 'success' || status === 'skipped', status, result, error, run, toolCalls }
}
