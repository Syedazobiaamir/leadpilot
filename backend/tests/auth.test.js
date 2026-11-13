// Stage 8 Step 2: staff login, sessions, and "every route is locked unless it is on the public list".
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import request from 'supertest'
import { createApp } from '../app.js'
import { readAuthConfig } from '../config.js'
import { COOKIE_NAME, createAuthService, hashPassword, SESSION_TTL_MS, useAuthForTests, verifyPassword } from '../services/authService.js'
import { useLimitsForTests } from '../middleware/limiters.js'
import { TEST_PASSWORD, TEST_PASSWORD_HASH, TEST_SESSION_SECRET, asVisitor } from './staffSession.js'

const app = createApp()
const cookieOf = (res) => (res.headers['set-cookie'] ?? [])[0] ?? ''
const tokenOf = (res) => cookieOf(res).split(';')[0].slice(COOKIE_NAME.length + 1)
const login = (password) => asVisitor(request(app).post('/api/auth/login')).send({ password })
const withToken = (req, token) => req.set('Cookie', `${COOKIE_NAME}=${token}`)

// ---------------------------------------------------------------------------------------
describe('password hashing (scrypt)', () => {
  it('verifies the right password, rejects others, and never contains the password', () => {
    const hash = hashPassword('a long test password', { N: 1024 })
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$/)
    expect(hash).not.toContain('a long test password')
    expect(verifyPassword('a long test password', hash)).toBe(true)
    expect(verifyPassword('a long test passworD', hash)).toBe(false)
    expect(verifyPassword('', hash)).toBe(false)
    expect(verifyPassword(undefined, hash)).toBe(false)
    expect(verifyPassword('x', 'not-a-hash')).toBe(false)
  })

  it('the same password gets a different hash every time (random salt)', () => {
    expect(hashPassword('same password here', { N: 1024 })).not.toBe(hashPassword('same password here', { N: 1024 }))
  })
})

// ---------------------------------------------------------------------------------------
describe('POST /api/auth/login', () => {
  it('right password → 200 and a safe cookie (HttpOnly, SameSite=Strict, Path=/api, 8 h; no Secure on plain-HTTP dev)', async () => {
    const res = await login(TEST_PASSWORD)
    expect(res.status).toBe(200)
    expect(res.body.data.loggedIn).toBe(true)
    const cookie = cookieOf(res)
    expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=[^;]+`))
    for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/api', `Max-Age=${SESSION_TTL_MS / 1000}`]) expect(cookie).toContain(part)
    expect(cookie).not.toContain('Secure')
    expect(JSON.stringify(res.body)).not.toContain(tokenOf(res)) // the token is only in the cookie
  })

  it.each([['a wrong password', 'wrong password!!'], ['an empty password', ''], ['no password', undefined], ['a huge password', 'x'.repeat(5000)]])(
    '%s → 401 INVALID_PASSWORD, and no cookie',
    async (_label, password) => {
      const res = await login(password)
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_PASSWORD')
      expect(res.headers['set-cookie']).toBeUndefined()
    },
  )

  it('password guessing: after 5 tries in 15 minutes → 429, even with the RIGHT password', async () => {
    useLimitsForTests({ loginPer15Minutes: 5 })
    try {
      for (let i = 0; i < 5; i++) expect((await login('guess ' + i)).status).toBe(401)
      const blocked = await login(TEST_PASSWORD)
      expect(blocked.status).toBe(429)
      expect(blocked.body.error.code).toBe('RATE_LIMITED')
    } finally {
      useLimitsForTests()
    }
  })
})

describe('sessions', () => {
  it('the login cookie opens staff routes; no cookie → 401 NOT_LOGGED_IN', async () => {
    const token = tokenOf(await login(TEST_PASSWORD))
    expect((await withToken(request(app).get('/api/leads'), token)).status).toBe(200)
    const anonymous = await asVisitor(request(app).get('/api/leads'))
    expect(anonymous.status).toBe(401)
    expect(anonymous.body.error.code).toBe('NOT_LOGGED_IN')
    expect(JSON.stringify(anonymous.body)).not.toContain('@example.com') // no customer data at all
  })

  it('a CHANGED token (e.g. a later expiry written by hand) is rejected: the signature no longer matches', async () => {
    const token = tokenOf(await login(TEST_PASSWORD))
    const [, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 10 * 365 * 24 * 3600 * 1000, pv: 'x' })).toString('base64url')
    expect((await withToken(request(app).get('/api/leads'), `${forged}.${signature}`)).status).toBe(401)
    expect((await withToken(request(app).get('/api/leads'), `${token}x`)).status).toBe(401)
    expect((await withToken(request(app).get('/api/leads'), 'garbage')).status).toBe(401)
  })

  it('an EXPIRED session is rejected', () => {
    let t = Date.parse('2026-11-11T09:00:00Z')
    const service = createAuthService({ passwordHash: TEST_PASSWORD_HASH, sessionSecret: TEST_SESSION_SECRET, now: () => t })
    const { token } = service.login(TEST_PASSWORD)
    expect(service.check(token)).not.toBeNull()
    t += SESSION_TTL_MS + 1
    expect(service.check(token)).toBeNull()
  })

  it('changing the PASSWORD ends every old session', () => {
    const before = createAuthService({ passwordHash: TEST_PASSWORD_HASH, sessionSecret: TEST_SESSION_SECRET })
    const { token } = before.login(TEST_PASSWORD)
    const after = createAuthService({ passwordHash: hashPassword('a brand new password', { N: 1024 }), sessionSecret: TEST_SESSION_SECRET })
    expect(after.check(token)).toBeNull()
  })

  it('a token signed with another SESSION_SECRET is rejected', () => {
    const other = createAuthService({ passwordHash: TEST_PASSWORD_HASH, sessionSecret: 'another-secret-0123456789abcdef-0123456' })
    const { token } = other.login(TEST_PASSWORD)
    expect(createAuthService({ passwordHash: TEST_PASSWORD_HASH, sessionSecret: TEST_SESSION_SECRET }).check(token)).toBeNull()
  })

  it('GET /api/auth/session tells the dashboard whether it is logged in', async () => {
    expect((await asVisitor(request(app).get('/api/auth/session'))).body.data).toEqual({ configured: true, loggedIn: false, expiresAt: null })
    const res = await request(app).get('/api/auth/session') // tests send a staff cookie by default
    expect(res.body.data).toMatchObject({ configured: true, loggedIn: true })
  })

  it('logout tells the browser to delete the cookie', async () => {
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(200)
    expect(cookieOf(res)).toMatch(new RegExp(`^${COOKIE_NAME}=;`))
    expect(cookieOf(res)).toContain('Max-Age=0')
  })
})

describe('login NOT set up on the server → staff routes stay CLOSED (fail closed)', () => {
  it('503 AUTH_NOT_CONFIGURED, never open', async () => {
    useAuthForTests({}) // no hash, no secret
    const res = await request(app).get('/api/leads')
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('AUTH_NOT_CONFIGURED')
    expect((await login('anything')).status).toBe(503)
    expect((await asVisitor(request(app).get('/api/auth/session'))).body.data.configured).toBe(false)
  })
})

describe('readAuthConfig', () => {
  const secret = 'x'.repeat(40)
  it('nothing set → null; both set → ok', () => {
    expect(readAuthConfig({})).toBeNull()
    expect(readAuthConfig({ STAFF_PASSWORD_HASH: TEST_PASSWORD_HASH, SESSION_SECRET: secret })).toEqual({ passwordHash: TEST_PASSWORD_HASH, sessionSecret: secret })
  })
  it('half a setup, a bad hash or a short secret → an error that never shows the values', () => {
    expect(() => readAuthConfig({ STAFF_PASSWORD_HASH: TEST_PASSWORD_HASH })).toThrow(/SESSION_SECRET is missing/)
    expect(() => readAuthConfig({ STAFF_PASSWORD_HASH: 'my-plain-password', SESSION_SECRET: secret })).toThrow(/not a scrypt hash/)
    try {
      readAuthConfig({ STAFF_PASSWORD_HASH: 'my-plain-password', SESSION_SECRET: 'short' })
    } catch (err) {
      expect(err.message).not.toContain('my-plain-password')
      expect(err.message).not.toContain('short"')
    }
  })
})

// ---------------------------------------------------------------------------------------
// THE LOCK CHECK: finds every route in the source code and checks that a visitor without a login
// can't use it, unless it is on the PUBLIC list. A new route that forgets the lock fails here.
const PUBLIC = new Set([
  'GET /api/health', 'GET /api/health/ready', // health checks (no data)
  'POST /api/leads', // the customer lead form
  'POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/auth/session', // how you get in
])
const AUTOMATION_PREFIX = '/api/automation' // n8n only: its own x-automation-key (tested in automation.test.js)

function allRoutes() {
  const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  const imports = Object.fromEntries([...appSource.matchAll(/import (\w+) from '\.\/routes\/([\w.]+)'/g)].map((m) => [m[1], m[2]]))
  const routes = []
  for (const [, prefix, name] of appSource.matchAll(/app\.use\('([^']+)', (\w+Routes)\)/g)) {
    const file = readFileSync(new URL(`../routes/${imports[name]}`, import.meta.url), 'utf8')
    for (const [, method, path] of file.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)) {
      routes.push({ method: method.toUpperCase(), path: (prefix + (path === '/' ? '' : path)) })
    }
  }
  return routes
}
const sample = (path) => path.replace(':id', path.includes('followups/:id') || path.startsWith('/api/followups') ? 'FU-1' : 'LD-1001')

describe('every route is locked unless it is meant to be public', () => {
  const routes = allRoutes()

  it('finds the routes in the source (sanity check)', () => {
    expect(routes.length).toBeGreaterThan(20)
    expect(routes).toContainEqual({ method: 'GET', path: '/api/leads' })
    expect(routes).toContainEqual({ method: 'POST', path: '/api/followups/:id/approve' })
  })

  const staffRoutes = routes.filter((r) => !PUBLIC.has(`${r.method} ${r.path}`) && !r.path.startsWith(AUTOMATION_PREFIX))
  it.each(staffRoutes.map((r) => [`${r.method} ${r.path}`, r]))('%s → 401 for a visitor without a login', async (_label, { method, path }) => {
    const res = await asVisitor(request(app)[method.toLowerCase()](sample(path))).send({})
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('NOT_LOGGED_IN')
  })

  const automationRoutes = routes.filter((r) => r.path.startsWith(AUTOMATION_PREFIX))
  it.each(automationRoutes.map((r) => [`${r.method} ${r.path}`, r]))('%s → refused for a visitor (no automation key)', async (_label, { method, path }) => {
    const res = await asVisitor(request(app)[method.toLowerCase()](sample(path))).send({})
    expect([401, 503]).toContain(res.status)
    expect(res.body.error.code).toMatch(/^AUTOMATION_/)
  })
})
