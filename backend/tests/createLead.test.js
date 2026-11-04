import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { resetStore } from '../services/leadStore.js'

const app = createApp()
beforeEach(() => resetStore())

const validLead = {
  name: '  Tom Rivera ',
  phone: '512-555-0199',
  email: 'Tom.Rivera@Example.com',
  zip: '78702',
  serviceType: 'Siding',
  timeline: 'Within 1 month',
  message: 'Need new siding on a two-story house.',
}

const postLead = (body) => request(app).post('/api/leads').send(body)

describe('POST /api/leads: success', () => {
  it('creates a lead with 201, a Location header and cleaned data', async () => {
    const res = await postLead(validLead)

    expect(res.status).toBe(201)
    expect(res.headers.location).toBe('/api/leads/LD-1011')
    expect(res.body.data).toMatchObject({
      id: 'LD-1011',
      name: 'Tom Rivera', // trimmed
      email: 'tom.rivera@example.com', // lowercased
      status: 'New',
      classification: null,
      score: null,
      source: 'Website form',
    })
    expect(Number.isNaN(Date.parse(res.body.data.createdAt))).toBe(false)
  })

  it('stores the lead so GET returns it', async () => {
    await postLead(validLead)
    const list = await request(app).get('/api/leads')
    expect(list.body.count).toBe(11)
    expect(list.body.data[0].id).toBe('LD-1011') // newest first

    const one = await request(app).get('/api/leads/LD-1011')
    expect(one.status).toBe(200)
  })

  it('writes an audit event without personal data', async () => {
    await postLead(validLead)
    const activity = await request(app).get('/api/activity')
    const event = activity.body.data[0]

    expect(event).toMatchObject({ type: 'lead', leadId: 'LD-1011' })
    expect(event.message).not.toMatch(/Tom|rivera|555/i)
  })

  it('ignores fields the client must not control (id, status, classification)', async () => {
    const res = await postLead({ ...validLead, id: 'LD-1', status: 'Won', classification: 'Hot', score: 100 })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ id: 'LD-1011', status: 'New', classification: null, score: null })
  })
})

describe('POST /api/leads: validation (permanent errors)', () => {
  it('returns 400 VALIDATION_ERROR with a message per invalid field', async () => {
    const res = await postLead({ ...validLead, email: 'nope', zip: '9021' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual({
      email: 'Enter a valid email address',
      zip: 'Enter a valid 5-digit US ZIP code',
    })
  })

  it('lists every missing field for an empty object', async () => {
    const res = await postLead({})
    expect(res.status).toBe(400)
    expect(Object.keys(res.body.error.details).sort()).toEqual(
      ['email', 'message', 'name', 'phone', 'serviceType', 'timeline', 'zip'].sort(),
    )
  })

  it('gives human-readable messages when fields are missing or have the wrong type', async () => {
    const res = await postLead({ name: 'Tom Rivera', email: 'tom@example.com', zip: 78702 })
    expect(res.body.error.details).toMatchObject({
      phone: 'Phone number is required',
      zip: 'ZIP code is required', // a number instead of text
      message: 'Project details is required',
    })
    expect(JSON.stringify(res.body)).not.toMatch(/expected string|received undefined/)
  })

  it.each([
    ['no body at all', undefined],
    ['a JSON array', [validLead]],
  ])('rejects %s', async (_label, body) => {
    const req = request(app).post('/api/leads')
    const res = body === undefined ? await req : await req.send(body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('does not store anything when validation fails', async () => {
    await postLead({ ...validLead, phone: '123' })
    const list = await request(app).get('/api/leads')
    expect(list.body.count).toBe(10)
  })
})

describe('POST /api/leads: duplicates', () => {
  it('returns 409 for the same email (any letter case)', async () => {
    await postLead(validLead)
    const res = await postLead({ ...validLead, phone: '512-555-0100', email: 'TOM.RIVERA@example.com' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DUPLICATE_LEAD')
  })

  it('returns 409 for the same phone written differently', async () => {
    await postLead(validLead)
    const res = await postLead({ ...validLead, email: 'other@example.com', phone: '+1 (512) 555-0199' })
    expect(res.status).toBe(409)
  })

  it('detects duplicates of existing sample leads without revealing which lead matched', async () => {
    const res = await postLead({ ...validLead, email: 'maria.gonzalez@example.com' })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).not.toMatch(/LD-1001|Maria/)
  })
})
