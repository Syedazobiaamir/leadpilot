// Stage 8 Step 1: security headers, rate limiting, the honeypot and the /ready cache.
import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

// Count real readiness checks (each one costs 7 Google Sheets reads in production).
const pings = vi.hoisted(() => ({ count: 0 }))
vi.mock('../services/leadStore.js', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, pingStore: async () => { pings.count++; return real.pingStore() } }
})

const { createApp } = await import('../app.js')
const { config, readTrustProxy } = await import('../config.js')
const { createRateLimiter } = await import('../middleware/rateLimit.js')
const { securityHeaders } = await import('../middleware/securityHeaders.js')
const { useLimitsForTests } = await import('../middleware/limiters.js')
const { errorHandler } = await import('../middleware/errorHandler.js')
const store = await import('../services/leadStore.js')

const app = createApp()
let n = 0
const lead = (changes = {}) => {
  n++
  return {
    name: 'Grace Hopper', phone: `512-555-02${String(n).padStart(2, '0')}`, email: `grace.sec${n}@example.com`, zip: '78701',
    serviceType: 'Roofing', timeline: 'ASAP', message: 'Roof leaking after the storm, water in the attic.', ...changes,
  }
}

afterEach(() => {
  useLimitsForTests() // back to the (high) test limits
  store.resetStore()
})

// ---------------------------------------------------------------------------------------
describe('security headers', () => {
  const expected = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'no-store',
  }

  it.each([['a success', '/api/health'], ['an error (404)', '/api/nope'], ['a data response', '/api/leads']])('are on %s', async (_label, path) => {
    const res = await request(app).get(path)
    for (const [name, value] of Object.entries(expected)) expect(res.headers[name]).toBe(value)
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
  })

  it('HSTS (always HTTPS) only in production', async () => {
    const make = (production) => express().use(securityHeaders({ production })).get('/', (req, res) => res.json({}))
    expect((await request(make(true)).get('/')).headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')
    expect((await request(make(false)).get('/')).headers['strict-transport-security']).toBeUndefined()
    expect((await request(app).get('/api/health')).headers['strict-transport-security']).toBeUndefined() // tests are not production
  })
})

// ---------------------------------------------------------------------------------------
describe('createRateLimiter', () => {
  function appWith(limiter) {
    return express().use(limiter).get('/', (req, res) => res.json({ ok: true })).use(errorHandler())
  }

  it('allows `max` requests per window, then 429 RATE_LIMITED with Retry-After; a new window starts fresh', async () => {
    let t = 1_000_000
    const limiter = createRateLimiter({ name: 'test', windowMs: 60_000, max: 3, now: () => t })
    const a = appWith(limiter)
    for (let i = 0; i < 3; i++) expect((await request(a).get('/')).status).toBe(200)
    const blocked = await request(a).get('/')
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('RATE_LIMITED')
    expect(blocked.headers['retry-after']).toBe('60')
    t += 30_000
    expect((await request(a).get('/')).headers['retry-after']).toBe('30') // counts down
    t += 30_000
    expect((await request(a).get('/')).status).toBe(200) // new window
  })

  it('counts each visitor (key) separately', async () => {
    const limiter = createRateLimiter({ name: 'test', windowMs: 60_000, max: 1, key: (req) => req.get('x-visitor') })
    const a = appWith(limiter)
    expect((await request(a).get('/').set('x-visitor', 'A')).status).toBe(200)
    expect((await request(a).get('/').set('x-visitor', 'A')).status).toBe(429)
    expect((await request(a).get('/').set('x-visitor', 'B')).status).toBe(200)
  })

  it('logs a flood once per window, not once per blocked request', async () => {
    const lines = []
    const logger = { warn: (msg) => lines.push(msg) }
    const a = appWith(createRateLimiter({ name: 'test', windowMs: 60_000, max: 1, logger }))
    for (let i = 0; i < 6; i++) await request(a).get('/')
    expect(lines).toEqual(['rate limit reached'])
  })
})

describe('the public lead form is rate limited', () => {
  it('more than the limit per minute → 429, and nothing extra is saved; reading is not affected', async () => {
    useLimitsForTests({ leadCreatePerMinute: 2 })
    const before = (await store.listLeads()).length
    expect((await request(app).post('/api/leads').send(lead())).status).toBe(201)
    expect((await request(app).post('/api/leads').send(lead())).status).toBe(201)
    const third = await request(app).post('/api/leads').send(lead())
    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('RATE_LIMITED')
    expect((await store.listLeads()).length).toBe(before + 2)
    expect((await request(app).get('/api/leads')).status).toBe(200)
  })

  it('behind a proxy (TRUST_PROXY=1), each real visitor IP gets its own limit', async () => {
    const original = config.trustProxy
    config.trustProxy = 1
    const proxied = createApp()
    config.trustProxy = original
    useLimitsForTests({ leadCreatePerMinute: 1 })
    const from = (ip) => request(proxied).post('/api/leads').set('X-Forwarded-For', ip).send(lead())
    expect((await from('203.0.113.1')).status).toBe(201)
    expect((await from('203.0.113.1')).status).toBe(429)
    expect((await from('203.0.113.2')).status).toBe(201) // a different visitor
  })

  it('readTrustProxy accepts a small number or nothing', () => {
    expect(readTrustProxy('')).toBe(false)
    expect(readTrustProxy(undefined)).toBe(false)
    expect(readTrustProxy('1')).toBe(1)
    expect(() => readTrustProxy('true')).toThrow(/Invalid TRUST_PROXY/)
    expect(() => readTrustProxy('10')).toThrow(/Invalid TRUST_PROXY/)
  })
})

// ---------------------------------------------------------------------------------------
describe('honeypot (a hidden field only bots fill in)', () => {
  it('filled in → 400 SUBMISSION_REJECTED and no lead is saved', async () => {
    const before = (await store.listLeads()).length
    const res = await request(app).post('/api/leads').send(lead({ website: 'http://spam.example' }))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('SUBMISSION_REJECTED')
    expect((await store.listLeads()).length).toBe(before)
  })

  it('empty (a real person) → saved as usual, and the field is not stored', async () => {
    const res = await request(app).post('/api/leads').send(lead({ website: '' }))
    expect(res.status).toBe(201)
    expect(res.body.data).not.toHaveProperty('website')
  })
})

// ---------------------------------------------------------------------------------------
describe('/api/health/ready is cached (it costs 7 Google Sheets reads)', () => {
  it('within the cache time, 20 calls make ONE real check; after it, a new check', async () => {
    const original = config.readyCacheMs
    config.readyCacheMs = 60_000
    try {
      await new Promise((r) => setTimeout(r, 5)) // make sure an earlier check (if any) is older than "now"
      config.readyCacheMs = 0
      await request(app).get('/api/health/ready') // fresh check now
      config.readyCacheMs = 60_000
      pings.count = 0
      const results = await Promise.all(Array.from({ length: 20 }, () => request(app).get('/api/health/ready')))
      expect(results.every((r) => r.status === 200 && r.body.status === 'ready')).toBe(true)
      expect(pings.count).toBe(0) // all answered from the check made just before
      expect(results[0].body.checkedAt).toBeDefined()

      config.readyCacheMs = 0
      await request(app).get('/api/health/ready')
      expect(pings.count).toBe(1)
    } finally {
      config.readyCacheMs = original
    }
  })
})
