// Staff login / logout / "am I logged in?" (Stage 8).
import { config } from '../config.js'
import { auth, readCookie, sessionCookie, SESSION_TTL_MS } from '../services/authService.js'
import { logger } from '../utils/logger.js'

const production = config.env === 'production'

export function login(req, res) {
  try {
    const { token, expiresAt } = auth().login(req.body?.password)
    res.set('Set-Cookie', sessionCookie(token, { maxAgeSeconds: SESSION_TTL_MS / 1000, production }))
    logger.info('staff logged in', { requestId: req.id })
    res.json({ data: { loggedIn: true, expiresAt } })
  } catch (err) {
    if (err.code === 'INVALID_PASSWORD') logger.warn('failed staff login', { requestId: req.id }) // never log the password
    throw err
  }
}

export function logout(req, res) {
  res.set('Set-Cookie', sessionCookie('', { maxAgeSeconds: 0, production })) // tells the browser to delete it
  res.json({ data: { loggedIn: false } })
}

/** Public: lets the dashboard decide between the login page and the app. */
export function session(req, res) {
  const current = auth()
  const s = current.configured ? current.check(readCookie(req)) : null
  res.json({ data: { configured: current.configured, loggedIn: Boolean(s), expiresAt: s?.expiresAt ?? null } })
}
