import { describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createApp } from '../app.js'
import { requestId } from '../middleware/requestId.js'
import { requestLogger } from '../middleware/requestLogger.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { AppError } from '../utils/AppError.js'
import { createLogger, redact } from '../utils/logger.js'

// A logger that stores lines in an array instead of printing, so tests can inspect them.
function memoryLogger() {
  const lines = []
  const log = createLogger({ level: 'debug', output: (line) => lines.push(JSON.parse(line)) })
  return { log, lines }
}

// A tiny app with routes that fail on purpose, to test the error handling on its own.
function appWithFailingRoutes(log) {
  const app = express()
  app.use(requestId)
  app.use(requestLogger(log))
  app.get('/known-error', () => {
    throw new AppError(409, 'DUPLICATE_LEAD', 'Lead already exists', { leadId: 'LD-1001' })
  })
  app.get('/bug', async () => {
    // An async route that throws. Express 5 must still catch it.
    await Promise.resolve()
    throw new Error('database password=hunter2 leaked in message')
  })
  app.use(errorHandler(log))
  return app
}

describe('requestId middleware', () => {
  it('generates an X-Request-Id when none is sent', async () => {
    const res = await request(createApp()).get('/api/health')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps a safe incoming request ID', async () => {
    const res = await request(createApp()).get('/api/health').set('X-Request-Id', 'n8n-run-42')
    expect(res.headers['x-request-id']).toBe('n8n-run-42')
  })

  it('replaces an unsafe incoming request ID', async () => {
    const res = await request(createApp()).get('/api/health').set('X-Request-Id', 'bad id <script>')
    expect(res.headers['x-request-id']).not.toBe('bad id <script>')
  })
})

describe('notFound + errorHandler', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(createApp()).get('/api/does-not-exist?email=a@b.com')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Route GET /api/does-not-exist not found', // query string not echoed back
      requestId: res.headers['x-request-id'],
    })
  })

  it('returns 400 INVALID_JSON for a broken JSON body', async () => {
    const res = await request(createApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"name": "Maria",')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_JSON')
  })

  it('returns 413 PAYLOAD_TOO_LARGE for bodies over 10kb', async () => {
    const res = await request(createApp())
      .post('/api/health')
      .send({ message: 'x'.repeat(11 * 1024) })
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('sends an AppError with its own status, code and details', async () => {
    const { log } = memoryLogger()
    const res = await request(appWithFailingRoutes(log)).get('/known-error')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({
      code: 'DUPLICATE_LEAD',
      message: 'Lead already exists',
      details: { leadId: 'LD-1001' },
    })
  })

  it('hides internal details of unexpected (async) errors from the client but logs them', async () => {
    const { log, lines } = memoryLogger()
    const res = await request(appWithFailingRoutes(log)).get('/bug')

    expect(res.status).toBe(500)
    expect(res.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side',
      requestId: res.headers['x-request-id'],
    })
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|stack/)

    const errorLine = lines.find((l) => l.msg === 'unhandled error')
    expect(errorLine.stack).toBeDefined()
    expect(errorLine.requestId).toBe(res.headers['x-request-id'])
  })
})

describe('requestLogger', () => {
  it('logs one structured line per request with status, duration and error code', async () => {
    const { log, lines } = memoryLogger()
    const res = await request(appWithFailingRoutes(log)).get('/known-error?token=secret')

    const line = lines.find((l) => l.msg === 'request rejected')
    expect(line).toMatchObject({
      level: 'warn',
      method: 'GET',
      path: '/known-error', // no query string
      status: 409,
      errorCode: 'DUPLICATE_LEAD',
      requestId: res.headers['x-request-id'],
    })
    expect(typeof line.durationMs).toBe('number')
    expect(JSON.stringify(lines)).not.toMatch(/secret/)
  })
})

describe('logger', () => {
  it('redacts sensitive fields at any depth', () => {
    expect(redact({ apiKey: 'abc', user: { password: 'x', name: 'Maria' }, list: [{ token: 't' }] })).toEqual({
      apiKey: '[REDACTED]',
      user: { password: '[REDACTED]', name: 'Maria' },
      list: [{ token: '[REDACTED]' }],
    })
  })

  it('respects the minimum level', () => {
    const lines = []
    const log = createLogger({ level: 'warn', output: (l) => lines.push(l) })
    log.info('ignored')
    log.warn('kept')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'warn', msg: 'kept' })
  })
})
