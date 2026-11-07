// Stage 5: the Lead Qualification Agent and its AgentRuns records.
// (The AI behaviour itself is covered, unchanged, by tests/qualification.test.js.)
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { resetStore } from '../services/leadStore.js'
import * as store from '../services/leadStore.js'
import { useAiClientForTests } from '../services/qualificationService.js'
import { orchestrator } from '../agents/orchestrator.js'
import { createQualificationAgent } from '../agents/qualificationAgent.js'
import { createToolRegistry } from '../agents/toolRegistry.js'
import { createTools } from '../agents/tools.js'
import { runAgent } from '../agents/runAgent.js'
import { createMemoryStore } from '../services/stores/memoryStore.js'
import { createLogger } from '../utils/logger.js'
import { createFakeGeminiClient } from './fakeGeminiClient.js'
import { contractSeed } from './storeContract.js'

const app = createApp()
const silent = createLogger({ level: 'silent' })
let ai, service
beforeEach(() => {
  resetStore()
  ai = createFakeGeminiClient()
  service = useAiClientForTests(ai, { logger: silent })
})
afterEach(async () => {
  await service.whenIdle()
  useAiClientForTests(null)
})

const runsFor = async (leadId) => (await request(app).get('/api/agent-runs')).body.data.filter((r) => r.leadId === leadId)

describe('the agent definition', () => {
  it('uses exactly three tools: read the lead, write AI fields, write audit events', () => {
    const agent = createQualificationAgent({ ai })
    expect(agent.name).toBe('qualification')
    expect(agent.tools).toEqual(['readLead', 'updateLeadAiFields', 'writeActivity'])
  })

  it('every data access goes through the tool registry (all calls are recorded and allowed)', async () => {
    const memory = createMemoryStore(structuredClone(contractSeed))
    const registry = createToolRegistry(createTools({ store: memory }), { logger: silent })
    const outcome = await runAgent({ agent: createQualificationAgent({ ai }), input: { leadId: 'LD-2002' }, registry, store: memory, logger: silent })

    expect(outcome.status).toBe('success')
    expect(outcome.toolCalls.map((c) => c.tool)).toEqual(['readLead', 'updateLeadAiFields', 'writeActivity'])
    expect(outcome.toolCalls.every((c) => c.allowed)).toBe(true)
  })

  it('a tampered agent that tries to change a phone number through its own tool is refused', async () => {
    const memory = createMemoryStore(structuredClone(contractSeed))
    const registry = createToolRegistry(createTools({ store: memory }), { logger: silent })
    const tampered = { ...createQualificationAgent({ ai }), run: ({ tools }) => tools.call('updateLeadAiFields', 'LD-2002', { phone: '0000000000' }) }
    const outcome = await runAgent({ agent: tampered, input: { leadId: 'LD-2002' }, registry, store: memory, logger: silent })

    expect(outcome.status).toBe('denied')
    expect((await memory.findLeadById('LD-2002')).phone).toBe('5125550102')
  })
})

describe('AgentRuns records for AI qualification', () => {
  const newLead = {
    name: 'Tom Rivera', phone: '512-555-0199', email: 'tom.rivera@example.com', zip: '78702',
    serviceType: 'Plumbing', timeline: 'ASAP', message: 'Water heater burst this morning, water all over the garage.',
  }

  it('a successful qualification is recorded with the outcome (no personal data)', async () => {
    const res = await request(app).post('/api/leads').send(newLead)
    await service.whenIdle()
    const [run] = await runsFor(res.body.data.id)

    expect(run).toMatchObject({ agent: 'qualification', status: 'success', errorKind: null, detail: 'Hot (score 88)' })
    expect(Number.isInteger(run.durationMs)).toBe(true)
    expect(JSON.stringify(run)).not.toMatch(/Tom|Rivera|555|burst/)
  })

  it('a failed AI call is recorded as "failed" with its kind', async () => {
    ai.failWith('quota_exhausted', { temporary: true })
    const res = await request(app).post('/api/leads').send(newLead)
    await service.whenIdle()
    const [run] = await runsFor(res.body.data.id)
    expect(run).toMatchObject({ agent: 'qualification', status: 'failed', errorKind: 'quota_exhausted' })
  })

  it('a flagged prompt injection shows in the run summary', async () => {
    ai.answerWith({ classification: 'Cold', score: 15, reason: 'Only browsing prices; contained instructions.', injectionSuspected: true })
    await request(app).post('/api/leads/LD-1005/qualify')
    await service.whenIdle()
    const [run] = await runsFor('LD-1005')
    expect(run.detail).toBe('Cold (score 15), injection flagged')
  })

  it('each re-run adds a new record (the trail is kept)', async () => {
    await request(app).post('/api/leads/LD-1001/qualify')
    await service.whenIdle()
    ai.failWith('timeout', { temporary: true })
    await request(app).post('/api/leads/LD-1001/qualify')
    await service.whenIdle()
    const runs = await runsFor('LD-1001')
    expect(runs.map((r) => r.status).sort()).toEqual(['failed', 'success'])
  })

  it('with AI disabled, NO AI agent runs (only the rule-based validation and the orchestrator)', async () => {
    service = useAiClientForTests(null)
    const res = await request(app).post('/api/leads').send(newLead)
    await orchestrator().whenIdle()
    const runs = await runsFor(res.body.data.id)
    expect(runs.map((r) => r.agent).sort()).toEqual(['orchestrator', 'validation'])
    expect(runs.find((r) => r.agent === 'orchestrator').detail).toBe('validation: ok → qualification: skipped (AI disabled)')
  })

  it('qualifyNow still maps outcomes to the same API errors as before', async () => {
    await expect(service.qualifyNow('LD-9999')).rejects.toMatchObject({ statusCode: 404, code: 'LEAD_NOT_FOUND' })
    ai.failWith('unavailable', { temporary: true })
    await expect(service.qualifyNow('LD-1001')).rejects.toMatchObject({ statusCode: 503, code: 'AI_UNAVAILABLE' })
    expect((await store.findLeadById('LD-1001')).classification).toBe('Hot') // previous result kept
  })
})
