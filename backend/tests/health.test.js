import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

describe('GET /api/health', () => {
  it('returns status ok with uptime and timestamp', async () => {
    const res = await request(createApp()).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.uptimeSeconds).toBe('number')
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false)
  })

  it('does not reveal that the server runs Express', async () => {
    const res = await request(createApp()).get('/api/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})
