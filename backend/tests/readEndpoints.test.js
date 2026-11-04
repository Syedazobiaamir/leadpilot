import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { resetStore } from '../services/leadStore.js'
import * as store from '../services/leadStore.js'

const app = createApp()

// Each test starts from the same sample data.
beforeEach(() => resetStore())

/** True if the list is sorted newest first by the given date field. */
function isNewestFirst(items, field) {
  const dates = items.map((item) => item[field])
  return dates.every((date, i) => i === 0 || dates[i - 1] >= date)
}

describe('GET /api/leads', () => {
  it('returns all sample leads, newest first, with a count', async () => {
    const res = await request(app).get('/api/leads')

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(10)
    expect(res.body.data).toHaveLength(10)
    expect(isNewestFirst(res.body.data, 'createdAt')).toBe(true)
    expect(res.body.data[0]).toMatchObject({ id: 'LD-1001', name: 'Maria Gonzalez', classification: 'Hot' })
  })
})

describe('GET /api/leads/:id', () => {
  it('returns one lead', async () => {
    const res = await request(app).get('/api/leads/LD-1003')
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: 'LD-1003', name: 'Emily Chen', serviceType: 'Kitchen Remodel' })
  })

  it('returns 404 LEAD_NOT_FOUND for an unknown ID', async () => {
    const res = await request(app).get('/api/leads/LD-9999')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('LEAD_NOT_FOUND')
  })

  it('returns 400 INVALID_LEAD_ID for a malformed ID', async () => {
    const res = await request(app).get('/api/leads/abc')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_LEAD_ID')
  })
})

describe('GET /api/activity', () => {
  it('returns activity events newest first', async () => {
    const res = await request(app).get('/api/activity')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(8)
    expect(isNewestFirst(res.body.data, 'timestamp')).toBe(true)
  })
})

describe('GET /api/workflow-runs', () => {
  it('returns workflow runs newest first', async () => {
    const res = await request(app).get('/api/workflow-runs')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(8)
    expect(isNewestFirst(res.body.data, 'startedAt')).toBe(true)
    expect(res.body.data.map((r) => r.status)).toEqual(
      expect.arrayContaining(['success', 'retrying', 'failed', 'escalated']),
    )
  })
})

describe('leadStore', () => {
  it('returns copies, so callers cannot change stored data by accident', async () => {
    const leads = await store.listLeads()
    leads[0].name = 'CHANGED'
    const fresh = await store.findLeadById(leads[0].id)
    expect(fresh.name).not.toBe('CHANGED')
  })
})
