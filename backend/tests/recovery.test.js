// Stage 7: recovery records + the Recovery Agent (sweep). Fake AI and a fake clock: no network,
// no real waiting. The clock is moved forward by hand ("5 minutes later").
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import * as store from '../services/leadStore.js'
import { resetStore } from '../services/leadStore.js'
import { useAiClientForTests } from '../services/qualificationService.js'
import { useRecoveryForTests } from '../services/recoveryService.js'
import { DAILY_BUDGET, MAX_EVENTS_PER_SWEEP, MAX_PER_SWEEP, STUCK_FOLLOWUP_MS, isBlocked, recoveryAgentDefinition, useRecoverySweepForTests } from '../agents/recoveryAgent.js'
import { useAutomationForTests } from '../services/automationService.js'
import { MAX_ATTEMPTS } from '../services/recovery/retryPolicy.js'
import { AiError } from '../services/ai/geminiClient.js'
import { AutomationError } from '../services/automation/automationClient.js'
import { createFakeGeminiClient } from './fakeGeminiClient.js'

const app = createApp()
const SECRET = 'test-automation-secret-0123456789abcdef'
const START = Date.parse('2026-11-10T12:00:00.000Z')
const MIN = 60_000

let clock, ai, qualifier, sweeper
const now = () => new Date(clock)
const later = (minutes) => {
  clock += minutes * MIN
}

function lead(id, changes = {}) {
  return {
    id, name: 'Rosa Diaz', phone: '5125550199', email: `${id.toLowerCase()}@example.com`, zip: '78701',
    serviceType: 'Roofing', timeline: 'ASAP', message: 'Roof leaking after the storm last night.', source: 'Website form',
    classification: null, score: null, status: 'New', createdAt: new Date(START - 60 * MIN).toISOString(),
    qualificationStatus: 'pending', aiReason: null, aiModel: null, qualifiedAt: null, reviewFlags: null, ...changes,
  }
}

const recordOf = async (leadId) => (await store.listRecoveries()).find((r) => r.targetId === leadId) ?? null
const messages = async () => (await store.listActivity()).map((e) => e.message)
const failAi = (kind, temporary, retryAfterSeconds) =>
  ai.answerWith(() => {
    throw new AiError(kind, `Simulated ${kind}`, { temporary, retryAfterSeconds })
  })
const answerHot = () => ai.answerWith({ classification: 'Hot', score: 90, reason: 'Active roof leak after a storm.', injectionSuspected: false })

/** One failing qualification (as if the Orchestrator or a person had started it). */
async function failOnce(leadId) {
  await qualifier.qualifyNow(leadId).catch(() => {})
}

beforeEach(async () => {
  resetStore()
  clock = START
  ai = createFakeGeminiClient()
  useRecoveryForTests({ now })
  qualifier = useAiClientForTests(ai, { now })
  sweeper = useRecoverySweepForTests({ now })
  useAutomationForTests() // automation off
  await store.insertLead(lead('LD-7001'))
})
afterEach(() => {
  useAiClientForTests(null)
  useRecoveryForTests()
  useRecoverySweepForTests()
})

// ---------------------------------------------------------------------------------------
describe('a failed AI qualification opens a recovery record', () => {
  it('temporary error → pending_retry, try 2 due in 5 minutes, explained in the activity log', async () => {
    failAi('timeout', true)
    await failOnce('LD-7001')

    const record = await recordOf('LD-7001')
    expect(record).toMatchObject({ kind: 'qualification', status: 'pending_retry', attempts: 1, lastErrorKind: 'timeout', nextRetryAt: new Date(START + 5 * MIN).toISOString() })
    expect(await messages()).toContainEqual(expect.stringMatching(/AI qualification of LD-7001 failed \(timeout\)\. Temporary error .*try 2 of 4 in 5 min/))
  })

  it('permanent error (wrong key) → escalated at once: NEEDS A PERSON, and the sweep never calls the AI again', async () => {
    failAi('auth', false)
    await failOnce('LD-7001')
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'escalated', attempts: 1, nextRetryAt: null })
    expect(await messages()).toContainEqual(expect.stringMatching(/^NEEDS A PERSON: AI qualification of LD-7001 .*Permanent error \(auth\)/))

    const calls = ai.calls.length
    later(120)
    await sweeper.sweep()
    expect(ai.calls.length).toBe(calls)
  })

  it('daily quota used up → waits for the reset Google gives, without using up a try', async () => {
    failAi('quota_exhausted', true, 3 * 3600)
    await failOnce('LD-7001')
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'pending_retry', attempts: 0, nextRetryAt: new Date(START + 180 * MIN).toISOString() })
  })

  it('one open record per problem: a second failure updates it instead of adding another', async () => {
    failAi('timeout', true)
    await failOnce('LD-7001')
    await failOnce('LD-7001')
    const records = (await store.listRecoveries()).filter((r) => r.targetId === 'LD-7001')
    expect(records).toHaveLength(1)
    expect(records[0].attempts).toBe(2)
  })
})

// ---------------------------------------------------------------------------------------
describe('the Recovery Agent sweep', () => {
  it('does nothing before the retry is due; retries when due; a success closes the record ("recovered")', async () => {
    failAi('unavailable', true)
    await failOnce('LD-7001')
    const callsAfterFailure = ai.calls.length

    later(4)
    expect((await sweeper.sweep()).counts.retried).toBe(0)
    expect(ai.calls.length).toBe(callsAfterFailure)

    answerHot()
    later(1) // now 5 minutes after the failure: due
    const result = await sweeper.sweep()
    expect(result.counts).toMatchObject({ retried: 1, recovered: 1 })
    expect(await store.findLeadById('LD-7001')).toMatchObject({ qualificationStatus: 'qualified', classification: 'Hot' })
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'recovered', nextRetryAt: null })
    expect(await messages()).toContainEqual('Recovered: AI qualification of LD-7001 worked after 2 tries.')
    expect(await messages()).toContainEqual('Automatic retry 2: AI qualification of LD-7001')
  })

  it(`keeps failing → backoff 5, 10, 20 min, then after ${MAX_ATTEMPTS} tries: escalated, no endless retries`, async () => {
    failAi('timeout', true)
    await failOnce('LD-7001') // try 1
    for (const wait of [5, 10, 20]) {
      later(wait)
      await sweeper.sweep() // tries 2, 3, 4
    }
    const record = await recordOf('LD-7001')
    expect(record).toMatchObject({ status: 'escalated', attempts: MAX_ATTEMPTS })
    expect(await messages()).toContainEqual(expect.stringMatching(/^NEEDS A PERSON: .*after 4 tries \(timeout\)/))

    const calls = ai.calls.length
    later(600)
    await sweeper.sweep()
    expect(ai.calls.length).toBe(calls) // nothing more
  })

  it('finds a STUCK lead ("pending" > 10 min, nothing running) and opens a record for it', async () => {
    await store.insertLead(lead('LD-7002', { createdAt: new Date(START - 3 * MIN).toISOString() })) // only 3 min: not stuck
    const result = await sweeper.sweep()
    expect(result.counts.stuck).toBe(1) // LD-7001 (60 min old)
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'pending_retry', lastErrorKind: 'stuck_pending' })
    expect(await recordOf('LD-7002')).toBeNull()
  })

  it('ADOPTS an old "failed" lead (from before Stage 7) using the error kind of its last agent run', async () => {
    await store.insertLead(lead('LD-7003', { qualificationStatus: 'failed' }))
    await store.insertAgentRun({ runId: 'AR-old', leadId: 'LD-7003', agent: 'qualification', status: 'failed', durationMs: 900, errorKind: 'rate_limited', detail: 'Gemini rate limit reached.', startedAt: '2026-11-09T10:00:00.000Z' })
    await store.insertLead(lead('LD-7004', { qualificationStatus: 'failed' })) // no agent run at all → unknown → a person must look
    await sweeper.sweep()
    expect(await recordOf('LD-7003')).toMatchObject({ status: 'pending_retry', lastErrorKind: 'rate_limited' })
    expect(await recordOf('LD-7004')).toMatchObject({ status: 'escalated', lastErrorKind: 'unknown' })
  })

  it('never spends AI on a lead the Validation Agent BLOCKED (test/spam)', async () => {
    await store.updateLead('LD-7001', { reviewFlags: 'test_or_placeholder' })
    expect(isBlocked(await store.findLeadById('LD-7001'))).toBe(true)
    const result = await sweeper.sweep()
    expect(result.counts.stuck).toBe(0)
    expect(ai.calls).toHaveLength(0)
  })

  it(`at most ${MAX_PER_SWEEP} AI retries per sweep; the rest waits for the next sweep`, async () => {
    failAi('timeout', true)
    for (const id of ['LD-7011', 'LD-7012', 'LD-7013', 'LD-7014']) {
      await store.insertLead(lead(id, { createdAt: new Date(START).toISOString() }))
      await failOnce(id)
    }
    answerHot()
    later(5)
    expect((await sweeper.sweep()).counts.retried).toBe(MAX_PER_SWEEP)
    expect((await sweeper.sweep()).counts.retried).toBe(1)
  })

  it(`daily budget: after ${DAILY_BUDGET} automatic retries today, the rest is postponed to tomorrow (no AI used)`, async () => {
    for (let i = 0; i < DAILY_BUDGET; i++) {
      await store.insertActivity({ id: `EV-rc-try-${i}`, type: 'recovery', message: 'Automatic retry', leadId: 'LD-1001', timestamp: new Date(START).toISOString() })
    }
    failAi('timeout', true)
    await failOnce('LD-7001')
    const calls = ai.calls.length
    later(5)
    const result = await sweeper.sweep()
    expect(result.counts).toMatchObject({ retried: 0, postponed: 1 })
    expect(ai.calls.length).toBe(calls)
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'pending_retry', nextRetryAt: '2026-11-11T00:00:00.000Z', attempts: 1 })
  })

  it('a person\'s successful manual retry closes an ESCALATED record', async () => {
    failAi('auth', false)
    await failOnce('LD-7001')
    answerHot() // the person fixed the key and clicked Retry
    await qualifier.qualifyNow('LD-7001')
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'recovered' })
    expect(await messages()).toContainEqual('Recovered: AI qualification of LD-7001 worked after a person stepped in.')
  })

  it('an ESCALATED problem stays with the person: their failing manual retry does not restart automatic retries', async () => {
    failAi('timeout', true)
    await failOnce('LD-7001')
    failAi('auth', false)
    later(5)
    await sweeper.sweep() // try 2 fails permanently → escalated
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'escalated', attempts: 2 })

    failAi('timeout', true) // the person clicks Retry; this time it is a TEMPORARY error
    await failOnce('LD-7001')
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'escalated', attempts: 2, nextRetryAt: null, lastErrorKind: 'timeout' })
    const calls = ai.calls.length
    later(120)
    await sweeper.sweep()
    expect(ai.calls.length).toBe(calls)
  })

  it('a record whose lead was qualified meanwhile is simply closed (no AI used)', async () => {
    failAi('timeout', true)
    await failOnce('LD-7001')
    await store.updateLead('LD-7001', { qualificationStatus: 'qualified', classification: 'Warm', score: 60 })
    const calls = ai.calls.length
    later(5)
    expect((await sweeper.sweep()).counts.recovered).toBe(1)
    expect(ai.calls.length).toBe(calls)
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'recovered' })
  })

  it('AI off → the sweep is skipped and changes nothing', async () => {
    useAiClientForTests(null)
    const result = await sweeper.sweep()
    expect(result.status).toBe('skipped')
    expect(await store.listRecoveries()).toHaveLength(0)
  })

  it('two sweeps at the same moment run only once', async () => {
    const [a, b] = await Promise.all([sweeper.sweep(), sweeper.sweep()])
    expect(a.runId).toBe(b.runId)
    expect((await store.listAgentRuns()).filter((r) => r.agent === 'recovery')).toHaveLength(1)
  })

  it('a sweep with NOTHING to do is not written to AgentRuns (it runs every 5 minutes)', async () => {
    await store.updateLead('LD-7001', { qualificationStatus: 'qualified', classification: 'Hot', score: 90 }) // nothing stuck
    const result = await sweeper.sweep()
    expect(result.summary).toMatch(/^nothing to do/)
    expect((await store.listAgentRuns()).filter((r) => r.agent === 'recovery')).toHaveLength(0)
  })

  it('a sweep that DID something is recorded in AgentRuns (agent "recovery") with a summary and no personal data', async () => {
    await sweeper.sweep()
    const [run] = (await store.listAgentRuns()).filter((r) => r.agent === 'recovery')
    expect(run).toMatchObject({ status: 'success', leadId: null })
    expect(run.detail).toMatch(/stuck 1/)
    expect(run.detail).not.toContain('Rosa')
  })

  it('has limited tools: nothing that sends, deletes, edits customer data or touches credentials', () => {
    const forbidden = /send|email|delete|remove|credential|secret|token|exec|update.*lead|setReview|saveFollowUp/i
    expect(recoveryAgentDefinition.tools.filter((t) => forbidden.test(t))).toEqual([])
    expect(recoveryAgentDefinition.tools).toContain('retryQualification')
  })
})

// ---------------------------------------------------------------------------------------
describe('endpoints', () => {
  it('POST /api/automation/recovery/sweep (n8n WF5) needs the key, then returns the counts', async () => {
    expect((await request(app).post('/api/automation/recovery/sweep')).status).toBe(503) // automation off: no secret
    useAutomationForTests({ secret: SECRET })
    expect((await request(app).post('/api/automation/recovery/sweep')).status).toBe(401)
    const res = await request(app).post('/api/automation/recovery/sweep').set('x-automation-key', SECRET)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ ok: true, status: 'success', counts: { stuck: 1 } })
  })

  it('GET /api/recoveries lists the records, most recently changed first', async () => {
    failAi('timeout', true)
    await failOnce('LD-7001')
    const res = await request(app).get('/api/recoveries')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
    expect(res.body.data[0]).toMatchObject({ targetId: 'LD-7001', status: 'pending_retry' })
  })
})

// ---------------------------------------------------------------------------------------
// Step 3: lost n8n hand-offs and stuck follow-ups

/** A fake n8n: records accepted events; can be "down" (unreachable) or have an inactive workflow. */
function createFakeN8n() {
  const sent = []
  let failure = null
  return {
    sent,
    down: () => (failure = new AutomationError('unreachable', 'Could not reach n8n at localhost:5678 (is n8n running?)', { temporary: true })),
    inactiveWorkflow: () => (failure = new AutomationError('not_found', 'n8n has no active workflow for this event', { temporary: false, httpStatus: 404 })),
    up: () => (failure = null),
    async send(type, data) {
      if (failure) throw failure
      sent.push({ type, data })
      return { eventId: `EVT-${sent.length}`, httpStatus: 200 }
    },
  }
}

describe('Step 3: lost n8n hand-offs and stuck follow-ups', () => {
  let n8n, automationSvc
  const followUp = (id, changes = {}) => ({
    id, leadId: 'LD-7001', channel: 'email', subject: 'Your roof', body: 'Hi Rosa, thanks for reaching out.', status: 'approved',
    aiModel: 'gemini-test', createdAt: new Date(START - 30 * MIN).toISOString(), decidedAt: new Date(START - 1 * MIN).toISOString(),
    editedAt: null, sentAt: null, sentVia: null, claimedAt: null, claimedBy: null, ...changes,
  })
  const handOffs = () => n8n.sent.filter((e) => e.type === 'followup.approved')
  const stuckSince = () => new Date(START - STUCK_FOLLOWUP_MS - MIN).toISOString()

  beforeEach(() => {
    n8n = createFakeN8n()
    automationSvc = useAutomationForTests({ client: n8n, secret: SECRET })
    useAiClientForTests(null) // AI off: only the hand-off part of the sweep runs
  })

  it('n8n DOWN when a follow-up is approved → record; n8n back → the sweep hands it off again → recovered', async () => {
    await store.insertFollowUp(followUp('FU-1', { status: 'draft', decidedAt: null }))
    n8n.down()
    expect((await request(app).post('/api/followups/FU-1/approve')).status).toBe(200) // the person's action still works
    await automationSvc.whenIdle()
    expect(await recordOf('FU-1')).toMatchObject({ kind: 'followup_event', status: 'pending_retry', attempts: 1, lastErrorKind: 'unreachable' })

    n8n.up()
    later(5)
    const result = await sweeper.sweep()
    await automationSvc.whenIdle()
    expect(result.counts).toMatchObject({ handOffs: 1, handOffsDelivered: 1 })
    expect(handOffs()).toHaveLength(1)
    expect(handOffs()[0].data).toMatchObject({ followUpId: 'FU-1', delivery: 'simulated' })
    expect(await recordOf('FU-1')).toMatchObject({ status: 'recovered' })
  })

  it('workflow NOT ACTIVE in n8n (permanent) → escalated at once, never retried', async () => {
    await store.insertFollowUp(followUp('FU-1', { status: 'draft', decidedAt: null }))
    n8n.inactiveWorkflow()
    await request(app).post('/api/followups/FU-1/approve')
    await automationSvc.whenIdle()
    expect(await recordOf('FU-1')).toMatchObject({ status: 'escalated', lastErrorKind: 'not_found' })
    n8n.up()
    later(60)
    await sweeper.sweep()
    expect(handOffs()).toHaveLength(0)
  })

  it('STUCK "approved" (15+ min, n8n never claimed it) → record → handed off again on a later sweep', async () => {
    await store.insertFollowUp(followUp('FU-2', { decidedAt: stuckSince() }))
    await store.insertFollowUp(followUp('FU-3')) // approved only 1 min ago: not stuck
    const first = await sweeper.sweep()
    expect(first.counts.stuckFollowUps).toBe(1)
    expect(await recordOf('FU-2')).toMatchObject({ kind: 'followup_event', status: 'pending_retry', lastErrorKind: 'not_handed_off' })
    expect(await recordOf('FU-3')).toBeNull()

    later(5)
    await sweeper.sweep()
    await automationSvc.whenIdle()
    expect(handOffs().map((e) => e.data.followUpId)).toEqual(['FU-2'])
  })

  it('STUCK "sending" (claimed 15+ min ago, never marked sent) → escalated, and NEVER handed off again', async () => {
    await store.insertFollowUp(followUp('FU-4', { status: 'sending', claimedBy: '77', claimedAt: stuckSince() }))
    await sweeper.sweep()
    expect(await recordOf('FU-4')).toMatchObject({ kind: 'followup_delivery', status: 'escalated' })
    expect(await messages()).toContainEqual(expect.stringMatching(/^NEEDS A PERSON: Delivery of FU-4 .*MAY have been delivered/))
    later(120)
    await sweeper.sweep()
    expect(handOffs()).toHaveLength(0)
    expect((await store.listRecoveries()).filter((r) => r.targetId === 'FU-4')).toHaveLength(1) // not re-opened
  })

  it('a due hand-off whose follow-up n8n already has ("sent") is resolved without handing it off again', async () => {
    await store.insertFollowUp(followUp('FU-5', { status: 'draft', decidedAt: null }))
    n8n.down()
    await request(app).post('/api/followups/FU-5/approve')
    await automationSvc.whenIdle()
    await store.updateFollowUp('FU-5', { status: 'sent' }) // e.g. the original event did arrive after all
    n8n.up()
    later(5)
    const result = await sweeper.sweep()
    expect(result.counts.handOffsResolved).toBe(1)
    expect(handOffs()).toHaveLength(0)
    expect(await recordOf('FU-5')).toMatchObject({ status: 'recovered' })
  })

  it('a lost Hot-lead alert is resolved without sending when the lead is no longer Hot', async () => {
    qualifier = useAiClientForTests(createFakeGeminiClient(), { now }) // the fake AI answers Hot by default
    n8n.down()
    await qualifier.qualifyNow('LD-7001')
    await automationSvc.whenIdle()
    expect(await recordOf('LD-7001')).toMatchObject({ kind: 'hot_lead_event', status: 'pending_retry' })

    await store.updateLead('LD-7001', { classification: 'Warm', score: 55 }) // re-qualified meanwhile
    useAiClientForTests(null)
    n8n.up()
    later(5)
    await sweeper.sweep()
    expect(n8n.sent).toHaveLength(0)
    expect(await recordOf('LD-7001')).toMatchObject({ status: 'recovered' })
    expect(await messages()).toContainEqual(expect.stringMatching(/Resolved: Hot-lead alert of LD-7001: the lead is no longer Hot \(Warm\)/))
  })

  it(`at most ${MAX_EVENTS_PER_SWEEP} hand-offs per sweep`, async () => {
    for (let i = 1; i <= MAX_EVENTS_PER_SWEEP + 2; i++) await store.insertFollowUp(followUp(`FU-${10 + i}`, { decidedAt: stuckSince() }))
    await sweeper.sweep() // opens the records
    later(5)
    expect((await sweeper.sweep()).counts.handOffs).toBe(MAX_EVENTS_PER_SWEEP)
  })

  it('n8n events OFF (and AI off) → the sweep is skipped and opens nothing', async () => {
    useAutomationForTests() // no client
    await store.insertFollowUp(followUp('FU-6', { decidedAt: stuckSince() }))
    const result = await sweeper.sweep()
    expect(result.status).toBe('skipped')
    expect(await recordOf('FU-6')).toBeNull()
  })
})
