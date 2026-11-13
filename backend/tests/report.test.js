// Stage 8 Step 4: the operational report, and requestId on every log line.
import { describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createApp } from '../app.js'
import { createMemoryStore } from '../services/stores/memoryStore.js'
import { AI_DAILY_LIMIT, buildOverview, startOfDayIn } from '../services/reportService.js'
import { createLogger } from '../utils/logger.js'
import { getRequestContext, runWithRequestContext } from '../utils/requestContext.js'
import { requestId } from '../middleware/requestId.js'
import { asVisitor } from './staffSession.js'

const NOW = new Date('2026-11-11T20:00:00.000Z') // 12:00 in Los Angeles (UTC-8 in November)
const ago = (hours) => new Date(NOW.getTime() - hours * 3600_000).toISOString()

const lead = (id, changes) => ({
  id, name: 'Test Person', phone: '5125550100', email: `${id}@example.com`, zip: '78701', serviceType: 'Roofing', timeline: 'ASAP',
  message: 'Roof leak.', source: 'Website form', classification: null, score: null, status: 'New', createdAt: ago(1),
  qualificationStatus: 'pending', aiReason: null, aiModel: null, qualifiedAt: null, reviewFlags: null, submissionKey: null, ...changes,
})
const run = (agent, status, startedAt, changes = {}) => ({ runId: `AR-${Math.random()}`, leadId: 'LD-1', agent, status, durationMs: 2000, errorKind: null, detail: null, startedAt, ...changes })

const seed = {
  leads: [
    lead('LD-1', { classification: 'Hot', aiModel: 'gemini-2.5-flash', qualificationStatus: 'qualified', createdAt: ago(2), qualifiedAt: new Date(Date.parse(ago(2)) + 30_000).toISOString() }),
    lead('LD-2', { classification: 'Warm', aiModel: 'gemini-2.5-flash', qualificationStatus: 'qualified', createdAt: ago(30), qualifiedAt: new Date(Date.parse(ago(30)) + 90_000).toISOString() }),
    lead('LD-3', { classification: 'Hot', aiModel: 'simulated', qualificationStatus: 'qualified', createdAt: ago(24 * 20) }), // old SIMULATED sample
    lead('LD-4', { reviewFlags: 'test_or_placeholder', createdAt: ago(3) }), // blocked
    lead('LD-5', { reviewFlags: 'too_vague', qualificationStatus: 'failed', createdAt: ago(5) }), // needs review
    // a RECENT simulated lead with a (fake) 60-minute "qualification": must never count as an AI result
    lead('LD-6', { classification: 'Cold', aiModel: 'simulated', qualificationStatus: 'qualified', createdAt: ago(6), qualifiedAt: ago(5) }),
    // an OLD sample row from before Stage 4: classification but no AI fields → labelled simulated, like the API does
    lead('LD-7', { classification: 'Warm', aiModel: null, qualificationStatus: null, createdAt: ago(24 * 30) }),
    // re-qualified BY HAND 3 days after the form: not part of "time to qualify" (automatic flow only)
    lead('LD-8', { classification: 'Warm', aiModel: 'gemini-2.5-flash', qualificationStatus: 'qualified', createdAt: ago(80), qualifiedAt: ago(8) }),
  ],
  agentRuns: [
    run('qualification', 'success', ago(2)),
    run('qualification', 'success', ago(30)),
    run('qualification', 'failed', ago(5), { errorKind: 'timeout', durationMs: 6000 }),
    run('qualification', 'failed', ago(4), { errorKind: 'quota_exhausted', durationMs: 400 }), // no quota used
    run('followup', 'success', ago(1.5)),
    run('followup', 'skipped', ago(1)), // no AI call
    run('validation', 'success', ago(2)), // not AI
    run('qualification', 'success', ago(24 * 10)), // outside the 7 days
  ],
  followUps: [
    { id: 'FU-1', status: 'draft' }, { id: 'FU-2', status: 'approved' }, { id: 'FU-3', status: 'sending' },
    { id: 'FU-4', status: 'sent' }, { id: 'FU-5', status: 'sent' }, { id: 'FU-6', status: 'rejected' },
  ],
  workflowRuns: [
    { id: 'WF-n8n-1', status: 'success', startedAt: ago(1) },
    { id: 'WF-n8n-2', status: 'escalated', startedAt: ago(2) },
    { id: 'WF-be-1', status: 'failed', startedAt: ago(3) },
    { id: 'WF-9031', status: 'success', startedAt: ago(4) }, // SAMPLE data: left out
    { id: 'WF-n8n-3', status: 'success', startedAt: ago(24 * 9) }, // outside the 7 days
  ],
  recoveries: [{ id: 'RC-1', status: 'pending_retry' }, { id: 'RC-2', status: 'escalated' }, { id: 'RC-3', status: 'recovered' }, { id: 'RC-4', status: 'recovered' }],
}

describe('buildOverview (the operational report)', () => {
  const report = () => buildOverview({ store: createMemoryStore(seed), now: () => NOW })

  it('leads: totals, the last 7 days per day, classes, review/blocked, and time to qualify (real AI only)', async () => {
    const { leads } = await report()
    expect(leads).toMatchObject({ total: 8, lastPeriod: 6, simulated: 3, needsReview: 1, blocked: 1 })
    expect(leads.byClass).toEqual({ Hot: 2, Warm: 3, Cold: 1, Unclassified: 2 })
    expect(leads.hotShare).toBeCloseTo(2 / 6, 3)
    expect(leads.perDay).toHaveLength(7)
    expect(leads.perDay.at(-1)).toEqual({ date: '2026-11-11', count: 4 })
    // median of 0.5 and 1.5 = 1. NOT counted: the SIMULATED lead's 60 min, and LD-8 (re-qualified by hand 72 h later)
    expect(leads.medianMinutesToQualify).toBe(1)
  })

  it('AI: runs, success rate, failure kinds; only real AI calls in the last 7 days', async () => {
    const { ai } = await report()
    expect(ai).toMatchObject({ qualificationRuns: 4, qualificationSuccessRate: 0.5, runs: 5, failed: 2, dailyLimit: AI_DAILY_LIMIT })
    expect(ai.failureKinds).toEqual({ timeout: 1, quota_exhausted: 1 })
  })

  it('AI requests TODAY are counted from midnight Pacific time, without quota refusals', async () => {
    const { ai } = await report()
    // Pacific midnight = 08:00 UTC; since then: qualification 18:00 (ok), 15:00 (timeout), followup 18:30 (ok).
    // The 16:00 quota refusal used no quota; the 14:00 run (ago 30h) was yesterday.
    expect(ai.requestsToday).toBe(3)
    expect(ai.quotaResetsAt).toBe('2026-11-12T08:00:00.000Z')
  })

  it('startOfDayIn handles summer and winter time', () => {
    expect(startOfDayIn('America/Los_Angeles', new Date('2026-11-11T20:00:00Z')).toISOString()).toBe('2026-11-11T08:00:00.000Z') // PST
    expect(startOfDayIn('America/Los_Angeles', new Date('2026-07-01T20:00:00Z')).toISOString()).toBe('2026-07-01T07:00:00.000Z') // PDT
    expect(startOfDayIn('America/Los_Angeles', new Date('2026-11-11T05:00:00Z')).toISOString()).toBe('2026-11-10T08:00:00.000Z') // still "yesterday" there
  })

  it('follow-ups, automation (real runs only) and self-healing', async () => {
    const r = await report()
    expect(r.followUps).toEqual({ waitingForApproval: 1, inProgress: 2, sent: 2, rejected: 1 })
    expect(r.automation).toEqual({ runs: 3, success: 1, failed: 1, escalated: 1 })
    expect(r.selfHealing).toEqual({ retrying: 1, needsPerson: 1, recovered: 2 })
  })

  it('an empty system gives zeros and nulls, never NaN', async () => {
    const empty = await buildOverview({ store: createMemoryStore({}), now: () => NOW })
    expect(JSON.stringify(empty)).not.toContain('NaN')
    expect(empty.leads.hotShare).toBeNull()
    expect(empty.ai.qualificationSuccessRate).toBeNull()
    expect(empty.leads.medianMinutesToQualify).toBeNull()
  })

  it('contains no personal data', async () => {
    const text = JSON.stringify(await report())
    expect(text).not.toContain('@example.com')
    expect(text).not.toContain('Test Person')
    expect(text).not.toContain('5125550100')
  })
})

describe('GET /api/reports/overview', () => {
  const app = createApp()
  it('staff get the report; visitors get 401', async () => {
    const res = await request(app).get('/api/reports/overview')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('leads.total')
    expect((await asVisitor(request(app).get('/api/reports/overview'))).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------------------
describe('requestId on every log line (Stage 8)', () => {
  it('the logger adds the current request\'s ID, and nothing outside a request', () => {
    const lines = []
    const log = createLogger({ level: 'debug', output: (l) => lines.push(JSON.parse(l)) })
    runWithRequestContext({ requestId: 'req-abc' }, () => log.warn('inside'))
    log.warn('outside')
    expect(lines[0]).toMatchObject({ msg: 'inside', requestId: 'req-abc' })
    expect(lines[1].requestId).toBeUndefined()
  })

  it('reaches deep, async code that never got the ID passed to it', async () => {
    const app = express().use(requestId).get('/', async (req, res) => {
      await new Promise((r) => setTimeout(r, 5))
      res.json({ seen: getRequestContext()?.requestId })
    })
    const res = await request(app).get('/')
    expect(res.body.seen).toBe(res.headers['x-request-id'])
  })

  it('keeps two requests apart', async () => {
    const app = express().use(requestId).get('/', async (req, res) => {
      await new Promise((r) => setTimeout(r, Number(req.query.wait)))
      res.json({ seen: getRequestContext()?.requestId })
    })
    const [a, b] = await Promise.all([request(app).get('/?wait=20'), request(app).get('/?wait=1')])
    expect(a.body.seen).toBe(a.headers['x-request-id'])
    expect(b.body.seen).toBe(b.headers['x-request-id'])
    expect(a.body.seen).not.toBe(b.body.seen)
  })
})
