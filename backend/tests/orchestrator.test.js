// Stage 5: the Orchestrator runs validation → qualification → follow-up (Hot only) for new leads.
// Two FAKE AI clients: one for qualification, one for follow-up drafts. No network.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { resetStore } from '../services/leadStore.js'
import * as store from '../services/leadStore.js'
import { useAiClientForTests } from '../services/qualificationService.js'
import { useFollowUpAiForTests } from '../services/followUpService.js'
import { orchestrator, useOrchestratorForTests } from '../agents/orchestrator.js'
import { createLogger } from '../utils/logger.js'
import { createFakeGeminiClient } from './fakeGeminiClient.js'

const app = createApp()
const silent = createLogger({ level: 'silent' })
const COMPANY = 'Acme Test Roofing'
const draftFor = (firstName) => ({
  subject: 'About your request',
  body: `Hi ${firstName},\n\nThank you for contacting us about your project. Our team will reach out soon to arrange a visit.\n\nBest regards,\n${COMPANY}`,
  injectionSuspected: false,
})

let qualifierAi, writerAi
beforeEach(() => {
  resetStore()
  qualifierAi = createFakeGeminiClient()
  writerAi = createFakeGeminiClient()
  writerAi.answerWith(draftFor('Tom'))
  useAiClientForTests(qualifierAi, { logger: silent })
  useFollowUpAiForTests(writerAi, { contractorName: COMPANY, logger: silent })
  useOrchestratorForTests({ logger: silent })
})
afterEach(async () => {
  await orchestrator().whenIdle()
  useAiClientForTests(null)
  useFollowUpAiForTests(null)
  useOrchestratorForTests()
})

const lead = (changes = {}) => ({
  name: 'Tom Rivera', phone: '512-555-0199', email: 'tom.rivera@example.com', zip: '78702',
  serviceType: 'Plumbing', timeline: 'ASAP', message: 'Water heater burst this morning, water all over the garage floor.',
  ...changes,
})

/** POSTs a lead, waits for the whole pipeline, returns { id, lead, runs, summary }. */
async function submit(body) {
  const res = await request(app).post('/api/leads').send(body)
  expect(res.status).toBe(201)
  await orchestrator().whenIdle()
  const id = res.body.data.id
  const runs = (await request(app).get('/api/agent-runs')).body.data.filter((r) => r.leadId === id)
  return {
    id,
    lead: (await request(app).get(`/api/leads/${id}`)).body.data,
    runs,
    summary: runs.find((r) => r.agent === 'orchestrator')?.detail,
    drafts: (await request(app).get(`/api/leads/${id}/followups`)).body.data,
  }
}

describe('the orchestrator itself', () => {
  it('has no tools: it can only call agents, never touch data', () => {
    expect(orchestrator().agent.tools).toEqual([])
  })

  it('the customer gets 201 right away, even if the AI is slow', async () => {
    qualifierAi.slowDown(300)
    const started = Date.now()
    const res = await request(app).post('/api/leads').send(lead())
    expect(res.status).toBe(201)
    expect(Date.now() - started).toBeLessThan(250)
    expect(res.body.data.qualificationStatus).toBe('pending')
  })
})

describe('the pipeline', () => {
  it('HOT lead: validation ok → qualification Hot → follow-up draft (2 AI calls)', async () => {
    const r = await submit(lead())

    expect(r.lead).toMatchObject({ classification: 'Hot', qualificationStatus: 'qualified', reviewFlags: [] })
    expect(r.drafts).toHaveLength(1)
    expect(r.drafts[0]).toMatchObject({ status: 'draft', leadId: r.id })
    expect(r.runs.map((x) => x.agent).sort()).toEqual(['followup', 'orchestrator', 'qualification', 'validation'])
    expect(r.summary).toBe(`validation: ok → qualification: Hot 88 → followup: draft ${r.drafts[0].id}`)
    expect(qualifierAi.calls).toHaveLength(1)
    expect(writerAi.calls).toHaveLength(1)
  })

  it('WARM lead: qualified, but no automatic draft (1 AI call)', async () => {
    qualifierAi.answerWith({ classification: 'Warm', score: 55, reason: 'Planned project.', injectionSuspected: false })
    const r = await submit(lead({ timeline: '1-3 months', message: 'Planning a kitchen remodel in about two months, plans are ready.' }))

    expect(r.lead.classification).toBe('Warm')
    expect(r.drafts).toEqual([])
    expect(writerAi.calls).toHaveLength(0)
    expect(r.summary).toBe('validation: ok → qualification: Warm 55 → followup: not automatic for this class')
  })

  it('TEST/SPAM lead: blocked by validation, NO AI call at all, lead stays pending with flags', async () => {
    // (at least 10 characters: shorter messages are already rejected by the form's validation)
    const r = await submit(lead({ name: 'Test User', message: 'test test test test' }))

    expect(qualifierAi.calls).toHaveLength(0)
    expect(writerAi.calls).toHaveLength(0)
    expect(r.lead).toMatchObject({ qualificationStatus: 'pending', classification: null, reviewFlags: ['test_or_placeholder'] })
    expect(r.summary).toBe('validation: blocked → qualification: skipped (blocked lead, no AI used)')
    expect(r.runs.map((x) => x.agent).sort()).toEqual(['orchestrator', 'validation'])
  })

  it('a "review" flag (one link) does not stop the AI', async () => {
    const r = await submit(lead({ message: 'Water heater burst, photo of the damage: https://photos.example.com/heater' }))
    expect(r.lead.reviewFlags).toEqual(['contains_link'])
    expect(r.lead.classification).toBe('Hot')
    expect(r.summary).toMatch(/^validation: review \(contains_link\) → qualification: Hot 88 → followup: draft/)
  })

  it('qualification fails → the pipeline stops there: no follow-up attempt', async () => {
    qualifierAi.failWith('quota_exhausted', { temporary: true })
    const r = await submit(lead())
    expect(r.lead.qualificationStatus).toBe('failed')
    expect(writerAi.calls).toHaveLength(0)
    expect(r.summary).toBe('validation: ok → qualification: failed (see its run)')
    expect(r.runs.find((x) => x.agent === 'qualification')).toMatchObject({ status: 'failed', errorKind: 'quota_exhausted' })
  })

  it('follow-up fails → the lead stays qualified, and the failure is recorded', async () => {
    writerAi.failWith('timeout', { temporary: true })
    const r = await submit(lead())
    expect(r.lead.classification).toBe('Hot')
    expect(r.drafts).toEqual([])
    expect(r.summary).toBe('validation: ok → qualification: Hot 88 → followup: no new draft (see its run)')
    expect(r.runs.find((x) => x.agent === 'followup')).toMatchObject({ status: 'failed', errorKind: 'timeout' })
  })

  it('AI disabled for follow-ups only → qualified, draft skipped', async () => {
    useFollowUpAiForTests(null)
    const r = await submit(lead())
    expect(r.lead.classification).toBe('Hot')
    expect(r.summary).toBe('validation: ok → qualification: Hot 88 → followup: skipped (AI disabled)')
  })

  it('a validation failure (e.g. storage) does not stop the customer\'s lead from being qualified', async () => {
    const brokenStore = { ...store, updateLead: async (id, changes) => ('reviewFlags' in changes ? Promise.reject(new Error('storage hiccup')) : store.updateLead(id, changes)) }
    useOrchestratorForTests({ store: brokenStore, logger: silent })
    const r = await submit(lead())
    expect(r.summary).toMatch(/^validation: failed → qualification: Hot 88/)
  })

  it('the orchestrator summary never contains personal data', async () => {
    const r = await submit(lead())
    expect(JSON.stringify(r.runs)).not.toMatch(/Tom|Rivera|555-0199|tom\.rivera|78702|Water heater/)
  })

  it('starting the same lead twice WHILE it runs runs the pipeline once', async () => {
    qualifierAi.slowDown(50) // keep the first pipeline busy, so the second start really overlaps
    const res = await request(app).post('/api/leads').send(lead())
    orchestrator().start(res.body.data.id) // a second start while the first is still running
    await orchestrator().whenIdle()
    const runs = (await request(app).get('/api/agent-runs')).body.data.filter((r) => r.leadId === res.body.data.id)
    expect(runs.filter((r) => r.agent === 'orchestrator')).toHaveLength(1)
    expect(qualifierAi.calls).toHaveLength(1)
  })
})
