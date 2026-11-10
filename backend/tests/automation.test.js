// Stage 6: n8n automation. The events the backend sends, the endpoints n8n calls, and the
// security around them. No test reaches a real n8n: the client gets a fake fetch, and the
// services get a fake automation client.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import * as store from '../services/leadStore.js'
import { resetStore } from '../services/leadStore.js'
import { readAutomationConfig } from '../config.js'
import { AutomationError, createAutomationClient } from '../services/automation/automationClient.js'
import { cleanErrorText, useAutomationForTests, WORKFLOWS } from '../services/automationService.js'
import { useAiClientForTests } from '../services/qualificationService.js'
import { useFollowUpAiForTests } from '../services/followUpService.js'
import { sameSecret } from '../middleware/requireAutomationKey.js'
import { createLogger } from '../utils/logger.js'
import { createFakeGeminiClient } from './fakeGeminiClient.js'

const app = createApp()
const SECRET = 'test-automation-secret-0123456789abcdef'
const BASE = 'http://n8n.test:5678/webhook'

/** A fake automation client: records events, or fails like n8n would. */
function createFakeAutomationClient() {
  const sent = []
  let failure = null
  return {
    sent,
    failWith(kind, message = `Simulated ${kind}`) {
      failure = new AutomationError(kind, message, { temporary: true })
    },
    async send(type, data) {
      if (failure) throw failure
      sent.push({ type, data })
      return { eventId: `EVT-fake-${sent.length}`, httpStatus: 200 }
    },
  }
}

/** A fake fetch that records requests and answers with `respond(url, init)`. */
function fakeFetch(respond = () => ({ ok: true, status: 200 })) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return respond(url, init)
  }
  fn.calls = calls
  return fn
}

const withKey = (req) => req.set('x-automation-key', SECRET)

let lines, n8n, logger
beforeEach(() => {
  resetStore()
  lines = []
  logger = createLogger({ level: 'debug', output: (l) => lines.push(JSON.parse(l)) })
  n8n = createFakeAutomationClient()
})
afterEach(() => {
  useAutomationForTests() // automation off again for other test files
  useAiClientForTests(null)
  useFollowUpAiForTests(null)
})

// ---------------------------------------------------------------------------------------
describe('readAutomationConfig (settings)', () => {
  it('nothing set → automation off (null)', () => {
    expect(readAutomationConfig({})).toBeNull()
  })

  it('secret only → n8n may call us, but we send no events', () => {
    expect(readAutomationConfig({ AUTOMATION_SECRET: SECRET })).toEqual({ secret: SECRET, webhookBaseUrl: null })
  })

  it('secret + URL → both directions; a trailing "/" is removed', () => {
    expect(readAutomationConfig({ AUTOMATION_SECRET: SECRET, N8N_WEBHOOK_BASE_URL: `${BASE}/` })).toEqual({ secret: SECRET, webhookBaseUrl: BASE })
  })

  it('lists every problem at once, and never prints the secret', () => {
    const short = 'abc def'
    expect(() => readAutomationConfig({ AUTOMATION_SECRET: short, N8N_WEBHOOK_BASE_URL: 'localhost:5678' })).toThrow(/at least 32 characters[\s\S]*full http\(s\) URL/)
    try {
      readAutomationConfig({ AUTOMATION_SECRET: short })
    } catch (err) {
      expect(err.message).not.toContain(short)
    }
  })

  it('a URL without a secret is an error (n8n could not check who is calling)', () => {
    expect(() => readAutomationConfig({ N8N_WEBHOOK_BASE_URL: BASE })).toThrow(/AUTOMATION_SECRET is missing/)
  })
})

// ---------------------------------------------------------------------------------------
describe('automationClient (talking to n8n)', () => {
  const client = (fetchImpl, timeoutMs = 1000) => createAutomationClient({ baseUrl: BASE, secret: SECRET, timeoutMs, fetchImpl })

  it('POSTs the event envelope to the event path, with the key in a header', async () => {
    const fetchImpl = fakeFetch()
    const result = await client(fetchImpl).send('followup.approved', { followUpId: 'FU-1' })

    expect(fetchImpl.calls).toHaveLength(1)
    const { url, init } = fetchImpl.calls[0]
    expect(url).toBe(`${BASE}/followup-approved`)
    expect(init.method).toBe('POST')
    expect(init.headers['x-automation-key']).toBe(SECRET)
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ type: 'followup.approved', data: { followUpId: 'FU-1' } })
    expect(body.id).toMatch(/^EVT-/)
    expect(result.eventId).toBe(body.id)
    expect(JSON.stringify(body)).not.toContain(SECRET) // the secret is only in the header
  })

  it('refuses unknown event types without calling n8n', async () => {
    const fetchImpl = fakeFetch()
    await expect(client(fetchImpl).send('lead.deleted', {})).rejects.toMatchObject({ kind: 'bad_event' })
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it.each([
    [404, 'not_found', false],
    [401, 'auth', false],
    [403, 'auth', false],
    [400, 'rejected', false],
    [500, 'server_error', true],
    [503, 'server_error', true],
  ])('HTTP %i → kind %s (temporary: %s)', async (status, kind, temporary) => {
    const fetchImpl = fakeFetch(() => ({ ok: false, status }))
    await expect(client(fetchImpl).send('lead.qualified', {})).rejects.toMatchObject({ name: 'AutomationError', kind, temporary, httpStatus: status })
  })

  it('n8n not running → "unreachable", and the original error (which could hold secrets) is discarded', async () => {
    const fetchImpl = async () => {
      throw new Error(`connect ECONNREFUSED, headers: ${SECRET}`)
    }
    const err = await client(fetchImpl).send('lead.qualified', {}).catch((e) => e)
    expect(err).toMatchObject({ kind: 'unreachable', temporary: true })
    expect(err.message).toContain('n8n.test:5678')
    expect(err.message).not.toContain(SECRET)
  })

  it('n8n never answers → our own deadline gives up ("timeout")', async () => {
    const fetchImpl = () => new Promise(() => {}) // never settles
    const started = Date.now()
    await expect(client(fetchImpl, 50).send('lead.qualified', {})).rejects.toMatchObject({ kind: 'timeout', temporary: true })
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

// ---------------------------------------------------------------------------------------
describe('/api/automation/* security (only n8n may call these)', () => {
  it('503 AUTOMATION_NOT_CONFIGURED when the server has no secret', async () => {
    const res = await withKey(request(app).get('/api/automation/check'))
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('AUTOMATION_NOT_CONFIGURED')
  })

  it.each([
    ['no key', undefined],
    ['a wrong key', 'wrong-key'],
    ['the key with one extra character', `${SECRET}x`],
    ['an empty key', ''],
  ])('401 AUTOMATION_UNAUTHORIZED with %s', async (_label, key) => {
    useAutomationForTests({ secret: SECRET })
    let req = request(app).post('/api/automation/workflow-runs').send({})
    if (key !== undefined) req = req.set('x-automation-key', key)
    const res = await req
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTOMATION_UNAUTHORIZED')
  })

  it('the right key works', async () => {
    useAutomationForTests({ secret: SECRET })
    const res = await withKey(request(app).get('/api/automation/check'))
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ok')
  })

  it('sameSecret compares exactly (case, length, type)', () => {
    expect(sameSecret(SECRET, SECRET)).toBe(true)
    expect(sameSecret(SECRET.toUpperCase(), SECRET)).toBe(false)
    expect(sameSecret(undefined, SECRET)).toBe(false)
    expect(sameSecret(SECRET, null)).toBe(false)
  })

  it('the logger hides fields named like the automation key', () => {
    logger.info('x', { automationKey: SECRET, 'x-automation-key': SECRET, automation_key: SECRET })
    expect(JSON.stringify(lines)).not.toContain(SECRET)
  })
})

// ---------------------------------------------------------------------------------------
describe('POST /api/automation/workflow-runs (n8n reports a run)', () => {
  const report = { executionId: '1234', workflow: WORKFLOWS.sendFollowUp, leadId: 'LD-1001', status: 'retrying', attempts: 1, maxAttempts: 3, lastError: 'Timeout' }
  beforeEach(() => useAutomationForTests({ secret: SECRET, logger }))

  it('creates the run (201), then UPDATES it when the same execution reports again (200, no duplicate)', async () => {
    const first = await withKey(request(app).post('/api/automation/workflow-runs')).send(report)
    expect(first.status).toBe(201)
    expect(first.body.data).toMatchObject({ id: 'WF-n8n-1234', status: 'retrying', attempts: 1, leadId: 'LD-1001' })

    const second = await withKey(request(app).post('/api/automation/workflow-runs')).send({ ...report, status: 'success', attempts: 2, lastError: null })
    expect(second.status).toBe(200)
    expect(second.body.data).toMatchObject({ id: 'WF-n8n-1234', status: 'success', attempts: 2, lastError: null, startedAt: first.body.data.startedAt })

    const runs = (await request(app).get('/api/workflow-runs')).body.data
    expect(runs.filter((r) => r.id === 'WF-n8n-1234')).toHaveLength(1)
  })

  it('hides URLs in error messages (a Slack webhook URL is a secret)', async () => {
    const lastError = 'Slack answered 404 for https://hooks.slack.com/services/T000/B000/abcSECRETxyz'
    const res = await withKey(request(app).post('/api/automation/workflow-runs')).send({ ...report, status: 'escalated', attempts: 3, lastError })
    expect(res.body.data.lastError).toBe('Slack answered 404 for [URL hidden]')
    expect(cleanErrorText('x'.repeat(500))).toHaveLength(300)
  })

  it('ignores fields n8n may not set (the ID is always built from executionId)', async () => {
    const res = await withKey(request(app).post('/api/automation/workflow-runs')).send({ ...report, id: 'WF-HACK' })
    expect(res.body.data.id).toBe('WF-n8n-1234')
  })

  it.each([
    ['missing executionId', { ...report, executionId: undefined }, 'executionId'],
    ['executionId with odd characters', { ...report, executionId: '../1' }, 'executionId'],
    ['unknown status', { ...report, status: 'done' }, 'status'],
    ['attempts > maxAttempts', { ...report, attempts: 4 }, 'attempts'],
    ['bad leadId', { ...report, leadId: 'customer@example.com' }, 'leadId'],
    ['attempts as text', { ...report, attempts: '1' }, 'attempts'],
  ])('400 VALIDATION_ERROR: %s', async (_label, body, field) => {
    const res = await withKey(request(app).post('/api/automation/workflow-runs')).send(body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toHaveProperty(field)
  })
})

// ---------------------------------------------------------------------------------------
describe('POST /api/automation/activity (n8n writes an alert for the dashboard)', () => {
  const alert = { executionId: '77', type: 'escalation', message: 'Hot-lead alert failed at "Record the run": timeout', leadId: null }
  const post = (body) => withKey(request(app).post('/api/automation/activity')).send(body)
  beforeEach(() => useAutomationForTests({ secret: SECRET, logger }))

  it('201 writes the event, and the dashboard activity feed shows it', async () => {
    const res = await post({ ...alert, leadId: 'LD-1001' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ id: 'EV-n8n-77', type: 'escalation', message: alert.message, leadId: 'LD-1001' })
    const feed = (await request(app).get('/api/activity')).body.data
    expect(feed[0].id).toBe('EV-n8n-77') // newest first
  })

  it('one event per n8n run: a retry returns the first event (200) and adds nothing', async () => {
    await post(alert)
    const again = await post({ ...alert, message: 'a different text' })
    expect(again.status).toBe(200)
    expect(again.body.data.message).toBe(alert.message)
    expect((await store.listActivity()).filter((e) => e.id === 'EV-n8n-77')).toHaveLength(1)
  })

  it('hides URLs (secrets) in the message', async () => {
    const res = await post({ ...alert, message: 'failed: https://hooks.example.com/T0/SECRET' })
    expect(res.body.data.message).toBe('failed: [URL hidden]')
  })

  it.each([
    ['a type n8n may not use', { ...alert, type: 'lead' }, 'type'],
    ['an empty message', { ...alert, message: '  ' }, 'message'],
    ['a message over 500 characters', { ...alert, message: 'x'.repeat(501) }, 'message'],
    ['no executionId', { ...alert, executionId: undefined }, 'executionId'],
    ['a bad leadId', { ...alert, leadId: 'x' }, 'leadId'],
  ])('400 VALIDATION_ERROR: %s', async (_label, body, field) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(res.body.error.details).toHaveProperty(field)
  })

  it('needs the automation key', async () => {
    expect((await request(app).post('/api/automation/activity').send(alert)).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------------------
describe('POST /api/automation/followups/:id/mark-sent (n8n says it sent a follow-up)', () => {
  const followUp = (id, status) => ({
    id, leadId: 'LD-1001', channel: 'email', subject: 'Your roof', body: 'Hi Maria, thanks for reaching out.', status,
    aiModel: 'gemini-test', createdAt: '2026-11-08T10:00:00.000Z', decidedAt: null, editedAt: null, sentAt: null, sentVia: null,
  })
  const markSent = (id, body = { via: 'simulated' }) => withKey(request(app).post(`/api/automation/followups/${id}/mark-sent`)).send(body)
  const sentEvents = async (id) => (await store.listActivity()).filter((e) => e.message.startsWith(`Follow-up ${id} sent`))

  beforeEach(async () => {
    useAutomationForTests({ secret: SECRET, logger })
    for (const [id, status] of [['FU-A', 'approved'], ['FU-D', 'draft'], ['FU-R', 'rejected']]) await store.insertFollowUp(followUp(id, status))
  })

  it('approved → sent, with sentAt, sentVia "simulated" and an honest audit event', async () => {
    const res = await markSent('FU-A')
    expect(res.status).toBe(200)
    expect(res.body.alreadySent).toBe(false)
    expect(res.body.data).toMatchObject({ id: 'FU-A', status: 'sent', sentVia: 'simulated' })
    expect(Number.isNaN(Date.parse(res.body.data.sentAt))).toBe(false)
    const [event] = await sentEvents('FU-A')
    expect(event.message).toContain('SIMULATED')
  })

  it('is idempotent: a second call changes nothing and writes no second audit event', async () => {
    const first = await markSent('FU-A')
    const second = await markSent('FU-A')
    expect(second.status).toBe(200)
    expect(second.body.alreadySent).toBe(true)
    expect(second.body.data.sentAt).toBe(first.body.data.sentAt)
    expect(await sentEvents('FU-A')).toHaveLength(1)
  })

  it('two calls at the same moment are recorded once', async () => {
    const [a, b] = await Promise.all([markSent('FU-A'), markSent('FU-A')])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(await sentEvents('FU-A')).toHaveLength(1)
  })

  it.each([['FU-D', 'draft'], ['FU-R', 'rejected']])('409 FOLLOWUP_NOT_APPROVED for a %s follow-up (%s)', async (id) => {
    const res = await markSent(id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('FOLLOWUP_NOT_APPROVED')
    expect((await store.listFollowUps()).find((f) => f.id === id).status).not.toBe('sent')
  })

  it('404 / 400 for unknown or malformed IDs, 400 for an unknown delivery method', async () => {
    expect((await markSent('FU-NOPE')).body.error.code).toBe('FOLLOWUP_NOT_FOUND')
    expect((await markSent('LD-1001')).body.error.code).toBe('INVALID_FOLLOWUP_ID')
    const res = await markSent('FU-A', { via: 'email' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect((await store.listFollowUps()).find((f) => f.id === 'FU-A').status).toBe('approved')
  })

  it('GET /api/automation/followups/:id: status only (checked BEFORE delivering), no message or contact data', async () => {
    const res = await withKey(request(app).get('/api/automation/followups/FU-A'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ id: 'FU-A', leadId: 'LD-1001', status: 'approved', sentAt: null })
    await markSent('FU-A')
    expect((await withKey(request(app).get('/api/automation/followups/FU-A'))).body.data.status).toBe('sent')
    expect((await withKey(request(app).get('/api/automation/followups/FU-NOPE'))).status).toBe(404)
    expect((await withKey(request(app).get('/api/automation/followups/bad'))).status).toBe(400)
    expect((await request(app).get('/api/automation/followups/FU-A')).status).toBe(401)
  })

  it('needs the automation key (the dashboard cannot mark things sent)', async () => {
    const res = await request(app).post('/api/automation/followups/FU-A/mark-sent').send({ via: 'simulated' })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------------------
describe('events sent to n8n', () => {
  const COMPANY = 'Acme Test Roofing'
  const draft = { subject: 'Your roof leak', body: `Hi Maria,\n\nThank you for reaching out about the leak. Our team will contact you soon to arrange a visit.\n\nBest regards,\n${COMPANY}`, injectionSuspected: false }

  /** Writes a draft for LD-1001 with a fake AI and returns its ID. */
  async function draftId() {
    const ai = createFakeGeminiClient()
    ai.answerWith(draft)
    const service = useFollowUpAiForTests(ai, { contractorName: COMPANY })
    await request(app).post('/api/leads/LD-1001/followups')
    await service.whenIdle()
    return (await request(app).get('/api/leads/LD-1001/followups')).body.data[0].id
  }

  it('approving a draft sends "followup.approved" with the message, but no contact details', async () => {
    const automation = useAutomationForTests({ client: n8n, secret: SECRET, logger })
    const id = await draftId()
    const res = await request(app).post(`/api/followups/${id}/approve`)
    await automation.whenIdle()

    expect(res.status).toBe(200)
    expect(n8n.sent).toHaveLength(1)
    expect(n8n.sent[0]).toEqual({
      type: 'followup.approved',
      data: { followUpId: id, leadId: 'LD-1001', channel: 'email', subject: draft.subject, body: draft.body, delivery: 'simulated' },
    })
    const lead = await store.findLeadById('LD-1001')
    const payload = JSON.stringify(n8n.sent)
    for (const personal of [lead.email, lead.phone, lead.zip, lead.name]) expect(payload).not.toContain(personal)
    const events = (await store.listActivity()).map((e) => e.message)
    expect(events).toContain(`Follow-up ${id} approved by staff (handed to n8n for SIMULATED sending)`)
  })

  it('n8n down: the approval still succeeds, and a FAILED workflow run is recorded honestly', async () => {
    const automation = useAutomationForTests({ client: n8n, secret: SECRET, logger })
    n8n.failWith('unreachable', 'Could not reach n8n at localhost:5678 (is n8n running?)')
    const id = await draftId()
    const res = await request(app).post(`/api/followups/${id}/approve`)
    await automation.whenIdle()

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('approved')
    const run = (await store.listWorkflowRuns()).find((r) => r.id.startsWith('WF-be-'))
    expect(run).toMatchObject({ workflow: WORKFLOWS.sendFollowUp, leadId: 'LD-1001', status: 'failed', attempts: 1, maxAttempts: 1 })
    expect(run.lastError).toContain('Event not delivered to n8n')
    expect(lines.find((l) => l.msg === 'automation event failed')).toMatchObject({ kind: 'unreachable', type: 'followup.approved' })
  })

  it('a Hot qualification sends "lead.qualified" with the FIRST name only', async () => {
    const automation = useAutomationForTests({ client: n8n, secret: SECRET, logger })
    const ai = createFakeGeminiClient()
    ai.answerWith({ classification: 'Hot', score: 91, reason: 'Active roof leak after a storm.', injectionSuspected: false })
    const qualifier = useAiClientForTests(ai)
    const lead = await qualifier.qualifyNow('LD-1001')
    await automation.whenIdle()

    expect(n8n.sent).toHaveLength(1)
    expect(n8n.sent[0]).toEqual({
      type: 'lead.qualified',
      data: { leadId: 'LD-1001', firstName: lead.name.split(' ')[0], serviceType: lead.serviceType, timeline: lead.timeline, classification: 'Hot', score: 91, reason: 'Active roof leak after a storm.' },
    })
    const payload = JSON.stringify(n8n.sent)
    for (const personal of [lead.email, lead.phone, lead.zip, lead.name]) expect(payload).not.toContain(personal)
  })

  it('Warm and Cold leads send no alert', async () => {
    const automation = useAutomationForTests({ client: n8n, secret: SECRET, logger })
    const ai = createFakeGeminiClient()
    ai.answerWith({ classification: 'Warm', score: 60, reason: 'Planned project in a few months.', injectionSuspected: false })
    await useAiClientForTests(ai).qualifyNow('LD-1001')
    await automation.whenIdle()
    expect(n8n.sent).toHaveLength(0)
  })

  it('automation off: nothing is sent and nothing extra is recorded', async () => {
    useAutomationForTests() // no client, no secret
    const before = (await store.listWorkflowRuns()).length
    const ai = createFakeGeminiClient()
    await useAiClientForTests(ai).qualifyNow('LD-1001') // Hot by default
    expect((await store.listWorkflowRuns()).length).toBe(before)
  })

  it('/api/health reports whether automation is on', async () => {
    expect((await request(app).get('/api/health')).body.automation).toBe('disabled')
    useAutomationForTests({ client: n8n, secret: SECRET })
    expect((await request(app).get('/api/health')).body.automation).toBe('n8n')
  })
})
