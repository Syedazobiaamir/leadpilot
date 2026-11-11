// Stage 7 Step 4: duplicate protection and partial writes on POST /api/leads.
// The store is made SLOW here (like Google Sheets: each read takes time), which opens the window
// for the "check-then-insert" race. Without the create queue, these tests fail.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const control = vi.hoisted(() => ({ readDelayMs: 30, failActivity: false }))

vi.mock('../services/leadStore.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    // A slow read, like Google Sheets. Two requests can now both read before either one saves.
    listLeads: async () => {
      const leads = await real.listLeads()
      await new Promise((resolve) => setTimeout(resolve, control.readDelayMs))
      return leads
    },
    // Can be made to fail, to test a lead saved without its audit event (a partial write).
    insertActivity: async (event) => {
      if (control.failActivity && event.type === 'lead') throw Object.assign(new Error('Simulated Sheets failure'), { code: 'STORAGE_UNAVAILABLE' })
      return real.insertActivity(event)
    },
  }
})

const { createApp } = await import('../app.js')
const store = await import('../services/leadStore.js')

const app = createApp()
let n = 0
/** A valid, fictional lead with a unique email and phone (555-01xx numbers are reserved for fiction). */
function lead(changes = {}) {
  n++
  return {
    name: 'Grace Hopper', phone: `512-555-01${String(n).padStart(2, '0')}`, email: `grace.${n}@example.com`, zip: '78701',
    serviceType: 'Roofing', timeline: 'ASAP', message: 'Roof leaking after the storm, water in the attic.', ...changes,
  }
}
const post = (body, key) => {
  const req = request(app).post('/api/leads')
  return (key ? req.set('Idempotency-Key', key) : req).send(body)
}
const countLeads = async () => (await store.listLeads()).length

beforeEach(() => {
  store.resetStore()
  control.failActivity = false
})
afterEach(() => {
  control.failActivity = false
})

describe('the check-then-insert race (one create at a time)', () => {
  it('5 identical submissions at the same moment → exactly 1 lead, 4 × 409 DUPLICATE_LEAD', async () => {
    const before = await countLeads()
    const body = lead()
    const results = await Promise.all(Array.from({ length: 5 }, () => post(body)))
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409])
    expect(await countLeads()).toBe(before + 1)
  })

  it('5 DIFFERENT leads at the same moment → 5 leads with 5 different IDs', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post(lead())))
    expect(results.every((r) => r.status === 201)).toBe(true)
    const ids = results.map((r) => r.body.data.id)
    expect(new Set(ids).size).toBe(5)
  })

  it('a failed create does not block the next one', async () => {
    expect((await post({ ...lead(), email: 'not-an-email' })).status).toBe(400)
    expect((await post(lead())).status).toBe(201)
  })
})

describe('Idempotency-Key (a retried submission returns the SAME lead)', () => {
  it('same key twice → 201 both times, the second marked as a replay; still one lead and one audit event', async () => {
    const body = lead()
    const first = await post(body, 'form-submit-0001')
    const second = await post(body, 'form-submit-0001')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.headers['idempotent-replayed']).toBe('true')
    expect(first.headers['idempotent-replayed']).toBeUndefined()
    expect(second.body.data.id).toBe(first.body.data.id)
    expect((await store.listLeads()).filter((l) => l.email === body.email)).toHaveLength(1)
    expect((await store.listActivity()).filter((e) => e.leadId === first.body.data.id && e.type === 'lead')).toHaveLength(1)
  })

  it('5 retries with the same key at the same moment → one lead, all answered 201 with the same ID', async () => {
    const body = lead()
    const results = await Promise.all(Array.from({ length: 5 }, () => post(body, 'form-submit-0002')))
    expect(results.every((r) => r.status === 201)).toBe(true)
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1)
  })

  it('without a key, a resubmission is still a 409 DUPLICATE_LEAD (as before)', async () => {
    const body = lead()
    await post(body)
    const again = await post(body)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('DUPLICATE_LEAD')
  })

  it('the same key for a DIFFERENT person → 409 IDEMPOTENCY_KEY_REUSED (never someone else\'s lead)', async () => {
    await post(lead(), 'form-submit-0003')
    const other = await post(lead(), 'form-submit-0003')
    expect(other.status).toBe(409)
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(JSON.stringify(other.body)).not.toContain('LD-') // reveals nothing about the first lead
  })

  it.each([['too short', 'abc'], ['bad characters', 'key with spaces!'], ['too long', 'k'.repeat(101)]])('an invalid key (%s) → 400', async (_label, key) => {
    const res = await post(lead(), key)
    expect(res.status).toBe(400)
    expect(res.body.error.details).toHaveProperty('idempotencyKey')
  })

  it('the key is never shown by the API (create, list, get)', async () => {
    const created = await post(lead(), 'form-submit-0004')
    expect(created.body.data).not.toHaveProperty('submissionKey')
    const one = await request(app).get(`/api/leads/${created.body.data.id}`)
    expect(one.body.data).not.toHaveProperty('submissionKey')
    const all = await request(app).get('/api/leads')
    expect(JSON.stringify(all.body)).not.toContain('form-submit-0004')
  })
})

describe('partial writes', () => {
  it('lead saved but its audit event fails → still 201 (the lead is NOT lost or reported as failed)', async () => {
    control.failActivity = true
    const body = lead()
    const res = await post(body, 'form-submit-0005')
    expect(res.status).toBe(201)
    expect(await store.findLeadById(res.body.data.id)).toMatchObject({ email: body.email })
    // A retry of the same submission returns the same lead, not a confusing 409
    control.failActivity = false
    const retry = await post(body, 'form-submit-0005')
    expect(retry.status).toBe(201)
    expect(retry.body.data.id).toBe(res.body.data.id)
  })
})
