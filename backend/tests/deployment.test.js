// Stage 9: running on Vercel.
//  1. keepAlive → Vercel's waitUntil (background work must not be frozen after the answer is sent)
//  2. the Vercel entry point (api/index.js) serves the same Express app
//  3. vercel.json / .vercelignore keep their safety rules
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { resetStore } from '../services/leadStore.js'
import { orchestrator, useOrchestratorForTests } from '../agents/orchestrator.js'
import { keepAlive } from '../utils/background.js'
import { createLogger } from '../utils/logger.js'

// Vercel puts a "request context" on globalThis under this symbol; @vercel/functions' waitUntil uses it.
const VERCEL_CONTEXT = Symbol.for('@vercel/request-context')

/** Pretends we are inside a Vercel function. Returns the mock that receives every waitUntil promise. */
function pretendVercel() {
  const waitUntil = vi.fn()
  globalThis[VERCEL_CONTEXT] = { get: () => ({ waitUntil }) }
  return waitUntil
}

afterEach(() => {
  delete globalThis[VERCEL_CONTEXT]
})

describe('keepAlive (background work on Vercel)', () => {
  it('hands the work to Vercel\'s waitUntil and returns the SAME promise', async () => {
    const waitUntil = pretendVercel()
    const job = Promise.resolve('done')
    expect(keepAlive(job)).toBe(job)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await expect(waitUntil.mock.calls[0][0]).resolves.toBe('done')
  })

  it('a FAILING job: Vercel gets a promise that never rejects; the caller still sees the failure', async () => {
    const waitUntil = pretendVercel()
    const job = Promise.reject(new Error('AI down'))
    const returned = keepAlive(job)
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
    await expect(returned).rejects.toThrow('AI down')
  })

  it('outside Vercel (local server, tests) it changes nothing', async () => {
    const job = Promise.resolve(42)
    expect(keepAlive(job)).toBe(job)
    expect(await job).toBe(42)
  })
})

describe('a new lead on Vercel', () => {
  beforeEach(() => {
    resetStore()
    useOrchestratorForTests({ logger: createLogger({ level: 'silent' }) })
  })
  afterEach(() => useOrchestratorForTests())

  it('POST /api/leads answers 201 AND registers the background pipeline with waitUntil', async () => {
    const waitUntil = pretendVercel()
    const res = await request(createApp())
      .post('/api/leads')
      .send({ name: 'Kim Lee', phone: '512-555-0177', email: 'kim.lee@example.com', zip: '78701', serviceType: 'Roofing', timeline: 'ASAP', message: 'Leak over the kitchen after the storm.' })
    expect(res.status).toBe(201)
    expect(waitUntil).toHaveBeenCalled() // without this, Vercel could freeze the function mid-pipeline
    await orchestrator().whenIdle()
  })
})

describe('Vercel entry point (api/index.js)', () => {
  it('serves the same API: health + security headers', async () => {
    const { default: handler } = await import('../../api/index.js')
    const res = await request(handler).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('a configuration mistake → a clean 503 SERVER_MISCONFIGURED (no crash, no details)', async () => {
    vi.resetModules()
    vi.doMock('../app.js', () => {
      throw new Error('GOOGLE_PRIVATE_KEY is missing')
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { default: handler } = await import('../../api/index.js')
      const res = await request(handler).get('/api/health')
      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('SERVER_MISCONFIGURED')
      expect(JSON.stringify(res.body)).not.toContain('GOOGLE_PRIVATE_KEY') // the visitor gets no setup details
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('cannot start the API')) // the log says why
    } finally {
      errors.mockRestore()
      vi.doUnmock('../app.js')
      vi.resetModules()
    }
  })
})

describe('deployment config files', () => {
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
  const ignore = readFileSync(new URL('../../.vercelignore', import.meta.url), 'utf8').split(/\r?\n/)

  it('every /api request goes to the function; every other path to the app page', () => {
    expect(vercel.rewrites[0]).toEqual({ source: '/api/:path*', destination: '/api' })
    expect(vercel.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' })
    expect(Object.keys(vercel.functions)).toEqual(['api/index.js'])
  })

  it('the dashboard page gets strict browser rules (no inline scripts, no framing, HTTPS only)', () => {
    const page = vercel.headers.find((h) => h.source === '/((?!api/).*)')
    const get = (key) => page.headers.find((h) => h.key === key)?.value ?? ''
    const csp = get('Content-Security-Policy')
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self'") // the page may only talk to our own API
    expect(get('X-Content-Type-Options')).toBe('nosniff')
    expect(get('X-Frame-Options')).toBe('DENY')
    expect(get('Strict-Transport-Security')).toContain('max-age=')
  })

  it('.vercelignore keeps secrets and local backups out of uploads', () => {
    for (const line of ['.env', '**/.env', '**/.env.*', '**/STAFF-PASSWORD.txt', 'backups/', '*-key.json']) {
      expect(ignore).toContain(line)
    }
  })
})

describe('n8n workflows pointed at the live site (automation/scripts/point-workflows.mjs)', async () => {
  const { checkBaseUrl, pointWorkflow, LOCAL_BACKEND } = await import('../../automation/scripts/point-workflows.mjs')
  const { readdirSync } = await import('node:fs')
  const dir = new URL('../../automation/workflows/', import.meta.url)

  it('every workflow file calls the local backend (so local development works) and gets fully converted', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(files).toHaveLength(5)
    let total = 0
    for (const file of files) {
      const { text, count } = pointWorkflow(readFileSync(new URL(file, dir), 'utf8'), 'https://leadpilot.example.app')
      total += count
      expect(text).not.toContain(LOCAL_BACKEND)
      expect(text).not.toContain('localhost:3001')
      JSON.parse(text) // still valid JSON
    }
    expect(total).toBe(11)
  })

  it('accepts only a plain site address', () => {
    expect(checkBaseUrl('https://leadpilot-lac-psi.vercel.app/')).toBe('https://leadpilot-lac-psi.vercel.app')
    expect(() => checkBaseUrl('https://leadpilot-lac-psi.vercel.app/api')).toThrow(/without a path/)
    expect(() => checkBaseUrl('ftp://x.example')).toThrow(/https/)
    expect(() => checkBaseUrl('not a url')).toThrow(/full URL/)
  })

  it('refuses a copy that was already converted (nothing to replace)', () => {
    expect(() => pointWorkflow('{"url":"https://leadpilot.example.app/api/x"}', 'https://a.example')).toThrow(/already a converted copy/)
  })
})
