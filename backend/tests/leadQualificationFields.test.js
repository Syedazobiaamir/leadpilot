// Stage 4 lead fields: new leads start as "pending"; old (pre-Stage 4) leads get honest defaults.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { resetStore } from '../services/leadStore.js'
import { withQualificationDefaults } from '../services/leadService.js'

const app = createApp()
beforeEach(() => resetStore())

describe('new leads', () => {
  it('start with qualificationStatus "pending" and empty AI fields', async () => {
    const res = await request(app).post('/api/leads').send({
      name: 'Tom Rivera', phone: '512-555-0199', email: 'tom.rivera@example.com', zip: '78702',
      serviceType: 'Siding', timeline: 'Within 1 month', message: 'Need new siding on a two-story house.',
    })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ qualificationStatus: 'pending', aiReason: null, aiModel: null, qualifiedAt: null, classification: null })
  })

  it('clients cannot set the AI fields themselves', async () => {
    const res = await request(app).post('/api/leads').send({
      name: 'Tom Rivera', phone: '512-555-0199', email: 'tom.rivera@example.com', zip: '78702',
      serviceType: 'Siding', timeline: 'Within 1 month', message: 'Need new siding on a two-story house.',
      qualificationStatus: 'qualified', aiModel: 'gemini-fake', aiReason: 'I am very hot', classification: 'Hot',
    })
    expect(res.body.data).toMatchObject({ qualificationStatus: 'pending', aiModel: null, aiReason: null, classification: null })
  })
})

describe('sample leads', () => {
  it('are clearly labelled as simulated', async () => {
    const res = await request(app).get('/api/leads')
    for (const lead of res.body.data) {
      expect(lead).toMatchObject({ qualificationStatus: 'qualified', aiModel: 'simulated' })
      expect(lead.aiReason).toMatch(/^Simulated:/)
    }
  })
})

describe('withQualificationDefaults (rows created before Stage 4)', () => {
  const old = { id: 'LD-1', classification: null, score: null, qualificationStatus: null, aiReason: null, aiModel: null, qualifiedAt: null }

  it('a classified old lead is "qualified" by "simulated" (there was no AI before Stage 4)', () => {
    expect(withQualificationDefaults({ ...old, classification: 'Hot', score: 90 })).toMatchObject({ qualificationStatus: 'qualified', aiModel: 'simulated' })
  })

  it('an unclassified old lead is "pending"', () => {
    expect(withQualificationDefaults(old)).toMatchObject({ qualificationStatus: 'pending', aiModel: null })
  })

  it('works when the fields are completely missing (undefined)', () => {
    expect(withQualificationDefaults({ id: 'LD-2', classification: 'Cold' })).toMatchObject({ qualificationStatus: 'qualified', aiReason: null, aiModel: 'simulated', qualifiedAt: null })
  })

  it('never overrides real values', () => {
    const real = { ...old, classification: 'Warm', qualificationStatus: 'qualified', aiModel: 'gemini-x', aiReason: 'r', qualifiedAt: 't', reviewFlags: ['too_vague'] }
    expect(withQualificationDefaults(real)).toEqual(real)
  })
})
