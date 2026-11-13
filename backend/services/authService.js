// Staff login (Stage 8, decision D1A: one staff password). No extra packages: Node's crypto.
//
// PASSWORD: never stored. We store a scrypt HASH: a one-way "fingerprint" of the password.
//   scrypt is deliberately SLOW and memory-hungry, so an attacker who steals the hash can't try
//   billions of guesses. A random SALT per hash means two equal passwords get different hashes.
//   Format in .env:  STAFF_PASSWORD_HASH=scrypt$16384$8$1$<salt base64>$<hash base64>
//
// SESSION: after a correct password the browser gets a cookie "lp_session" holding a small,
//   SIGNED token:  <payload base64url>.<HMAC-SHA256 signature>
//   payload = { exp: when it expires, pv: a fingerprint of the password hash }
//   The signature uses SESSION_SECRET (only the server knows it), so a changed token is rejected.
//   "pv" makes every old session invalid as soon as the password is changed.
//   Nothing is stored on the server ("stateless"), so logging out only deletes the cookie;
//   to end ALL sessions at once, change SESSION_SECRET (documented).
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { AppError } from '../utils/AppError.js'
import { config } from '../config.js'

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours: one working day
export const COOKIE_NAME = 'lp_session'
export const MIN_PASSWORD_LENGTH = 12

const SCRYPT = { N: 16384, r: 8, p: 1 } // ~16 MB of memory per check
const KEY_LENGTH = 32

/** Password → "scrypt$N$r$p$salt$hash". Used by `npm run auth:set-password`. */
export function hashPassword(password, { N = SCRYPT.N, r = SCRYPT.r, p = SCRYPT.p } = {}) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LENGTH, { N, r, p, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/** True if `password` matches the stored hash. Compared in constant time. */
export function verifyPassword(password, stored) {
  const parts = String(stored).split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt' || typeof password !== 'string') return false
  const [, N, r, p, salt, hash] = parts
  const expected = Buffer.from(hash, 'base64')
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 })
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const b64url = (buffer) => Buffer.from(buffer).toString('base64url')
const sign = (payload, secret) => createHmac('sha256', secret).update(payload).digest('base64url')
/** A short fingerprint of the password hash: changing the password invalidates old sessions. */
const passwordVersion = (passwordHash) => createHash('sha256').update(passwordHash).digest('base64url').slice(0, 12)

/** Same length + constant time, so the comparison doesn't leak how much of a signature was right. */
function sameText(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * passwordHash, sessionSecret: from .env (null = login not configured → protected routes stay CLOSED)
 * now: clock (tests)
 */
export function createAuthService({ passwordHash = null, sessionSecret = null, now = () => Date.now(), ttlMs = SESSION_TTL_MS } = {}) {
  const configured = Boolean(passwordHash && sessionSecret)

  function notConfigured() {
    return new AppError(503, 'AUTH_NOT_CONFIGURED', 'Staff login is not set up on this server (run "npm run auth:set-password").')
  }

  return {
    configured,

    /** Correct password → { token, expiresAt }. Wrong → 401 INVALID_PASSWORD (same message for every mistake). */
    login(password) {
      if (!configured) throw notConfigured()
      if (typeof password !== 'string' || password.length === 0 || password.length > 200 || !verifyPassword(password, passwordHash)) {
        throw new AppError(401, 'INVALID_PASSWORD', 'Wrong password.')
      }
      const exp = now() + ttlMs
      const payload = b64url(JSON.stringify({ exp, pv: passwordVersion(passwordHash) }))
      return { token: `${payload}.${sign(payload, sessionSecret)}`, expiresAt: new Date(exp).toISOString() }
    },

    /** A cookie token → { expiresAt } if it is genuine, unexpired and for the current password; otherwise null. */
    check(token) {
      if (!configured) throw notConfigured()
      const [payload, signature, extra] = String(token ?? '').split('.')
      if (!payload || !signature || extra !== undefined) return null
      if (!sameText(signature, sign(payload, sessionSecret))) return null // forged or changed
      let data
      try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      } catch {
        return null
      }
      if (typeof data.exp !== 'number' || data.exp <= now()) return null // expired
      if (data.pv !== passwordVersion(passwordHash)) return null // the password was changed since
      return { expiresAt: new Date(data.exp).toISOString() }
    },
  }
}

/** Reads one cookie from the Cookie header (no cookie-parser package needed for one cookie). */
export function readCookie(req, name = COOKIE_NAME) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

/** The Set-Cookie value. HttpOnly: JavaScript can't read it. SameSite=Strict: other sites can't send it. */
export function sessionCookie(token, { maxAgeSeconds, production }) {
  return [
    `${COOKIE_NAME}=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/api', `Max-Age=${maxAgeSeconds}`,
    ...(production ? ['Secure'] : []), // HTTPS only in production (localhost is plain HTTP)
  ].join('; ')
}

// ---- The instance the app uses -------------------------------------------------------
let current = createAuthService(config.auth ?? {})

export const auth = () => current

/** TESTS ONLY: replace the auth service (e.g. with a test password). */
export function useAuthForTests(options = {}) {
  current = createAuthService(options)
  return current
}
