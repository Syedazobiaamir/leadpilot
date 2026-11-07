// Stage 5 agent framework: tool registry, permissions, and AgentRuns records.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { createMemoryStore } from '../services/stores/memoryStore.js'
import { createToolRegistry, PermissionError } from '../agents/toolRegistry.js'
import { AI_FIELDS, createTools } from '../agents/tools.js'
import { runAgent } from '../agents/runAgent.js'
import { resetStore } from '../services/leadStore.js'
import { createLogger } from '../utils/logger.js'
import { contractSeed } from './storeContract.js'

let store, registry, lines, logger
beforeEach(() => {
  store = createMemoryStore(structuredClone(contractSeed))
  lines = []
  logger = createLogger({ level: 'debug', output: (l) => lines.push(JSON.parse(l)) })
  registry = createToolRegistry(createTools({ store }), { logger })
})

/** A tiny agent for tests. */
const agent = (name, tools, run) => ({ name, description: 'test agent', tools, run })

describe('tool registry: permissions', () => {
  it('an agent can use the tools on its list', async () => {
    const reader = agent('reader', ['readLead'], async ({ input, tools }) => {
      const lead = await tools.call('readLead', input.leadId)
      return { summary: `read ${lead.id}` }
    })
    const outcome = await runAgent({ agent: reader, input: { leadId: 'LD-2001' }, registry, store, logger })
    expect(outcome).toMatchObject({ ok: true, status: 'success', result: { summary: 'read LD-2001' } })
    expect(outcome.toolCalls).toEqual([{ tool: 'readLead', allowed: true }])
  })

  it('a tool NOT on the list is refused, logged, and the run is recorded as "denied"', async () => {
    const sneaky = agent('sneaky', ['readLead'], async ({ input, tools }) => {
      await tools.call('updateLeadAiFields', input.leadId, { classification: 'Hot' })
    })
    const outcome = await runAgent({ agent: sneaky, input: { leadId: 'LD-2002' }, registry, store, logger })

    expect(outcome).toMatchObject({ ok: false, status: 'denied' })
    expect(outcome.error).toBeInstanceOf(PermissionError)
    expect(outcome.toolCalls).toEqual([{ tool: 'updateLeadAiFields', allowed: false }])
    expect(lines).toContainEqual(expect.objectContaining({ msg: 'agent permission denied', agent: 'sneaky', tool: 'updateLeadAiFields' }))
    expect((await store.findLeadById('LD-2002')).classification).toBeNull() // nothing changed
  })

  it('updateLeadAiFields can only change AI fields, even for an agent allowed to use it', async () => {
    const tooBold = agent('too-bold', ['updateLeadAiFields'], async ({ input, tools }) => {
      await tools.call('updateLeadAiFields', input.leadId, { classification: 'Hot', phone: '000', status: 'Won' })
    })
    const outcome = await runAgent({ agent: tooBold, input: { leadId: 'LD-2002' }, registry, store, logger })

    expect(outcome.status).toBe('denied')
    expect(outcome.error.message).toBe('updateLeadAiFields may not change: phone, status')
    const lead = await store.findLeadById('LD-2002')
    expect(lead).toMatchObject({ classification: null, phone: '5125550102', status: 'New' }) // nothing changed at all
  })

  it('updateLeadAiFields works for the AI fields', async () => {
    const qualifier = agent('qualifier', ['updateLeadAiFields'], async ({ input, tools }) =>
      tools.call('updateLeadAiFields', input.leadId, { classification: 'Warm', score: 60, qualificationStatus: 'qualified' }),
    )
    await runAgent({ agent: qualifier, input: { leadId: 'LD-2002' }, registry, store, logger })
    expect(await store.findLeadById('LD-2002')).toMatchObject({ classification: 'Warm', score: 60, qualificationStatus: 'qualified' })
    expect(AI_FIELDS).not.toContain('status')
  })

  it('no dangerous tools exist: nothing to send, delete, run, or read credentials with', () => {
    for (const name of registry.names()) {
      expect(name).not.toMatch(/send|email|sms|delete|remove|credential|secret|exec|eval|shell/i)
    }
  })

  it('refuses to even register a dangerous tool', () => {
    expect(() => createToolRegistry({ sendEmail: { fn: () => {} } }, { logger })).toThrow(/Refusing to register tool "sendEmail"/)
    expect(() => createToolRegistry({ deleteLead: { fn: () => {} } }, { logger })).toThrow(/Refusing/)
    expect(() => createToolRegistry({ readCredentials: { fn: () => {} } }, { logger })).toThrow(/Refusing/)
  })

  it('checkAgent fails fast when an agent lists a tool that does not exist', () => {
    expect(() => registry.checkAgent(agent('x', ['readLead', 'launchRockets'], async () => {}))).toThrow(/unknown tool\(s\): launchRockets/)
    expect(() => registry.checkAgent(agent('y', ['readLead'], async () => {}))).not.toThrow()
  })
})

describe('runAgent: AgentRuns records', () => {
  it('records a successful run with agent, lead, duration and summary', async () => {
    const ok = agent('validation', ['readLead'], async () => ({ summary: 'no issues' }))
    await runAgent({ agent: ok, input: { leadId: 'LD-2001' }, registry, store, logger, now: () => new Date('2026-11-07T10:00:00Z') })
    const run = (await store.listAgentRuns()).find((r) => r.agent === 'validation')
    expect(run).toMatchObject({ leadId: 'LD-2001', status: 'success', errorKind: null, detail: 'no issues', startedAt: '2026-11-07T10:00:00.000Z' })
    expect(run.runId).toMatch(/^AR-/)
    expect(Number.isInteger(run.durationMs)).toBe(true)
  })

  it('an agent can report "skipped" (nothing to do)', async () => {
    const skipper = agent('followup', [], async () => ({ status: 'skipped', summary: 'not a Hot lead' }))
    const outcome = await runAgent({ agent: skipper, input: { leadId: 'LD-2002' }, registry, store, logger })
    expect(outcome).toMatchObject({ ok: true, status: 'skipped' })
  })

  it('a failing agent is recorded as "failed" with its error kind; runAgent itself never throws', async () => {
    const broken = agent('broken', [], async () => {
      throw Object.assign(new Error('Gemini did not respond in time.'), { kind: 'timeout' })
    })
    const outcome = await runAgent({ agent: broken, input: { leadId: 'LD-2001' }, registry, store, logger })
    expect(outcome).toMatchObject({ ok: false, status: 'failed', run: { errorKind: 'timeout', detail: 'Gemini did not respond in time.' } })
    expect(lines).toContainEqual(expect.objectContaining({ msg: 'agent run failed', agent: 'broken', errorKind: 'timeout' }))
  })

  it('if recording the run fails, the real outcome is still returned', async () => {
    const failingStore = { ...store, insertAgentRun: async () => { throw new Error('storage down') } }
    const ok = agent('validation', [], async () => ({ summary: 'fine' }))
    const outcome = await runAgent({ agent: ok, input: {}, registry, store: failingStore, logger })
    expect(outcome.status).toBe('success')
    expect(lines).toContainEqual(expect.objectContaining({ msg: 'could not record agent run' }))
  })
})

describe('GET /api/agent-runs', () => {
  it('returns agent runs (empty at first: there is no simulated agent data)', async () => {
    resetStore()
    const res = await request(createApp()).get('/api/agent-runs')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [], count: 0 })
  })
})
