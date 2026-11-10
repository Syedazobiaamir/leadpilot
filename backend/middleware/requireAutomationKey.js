// Protects the endpoints that only n8n may call (/api/automation/*).
// n8n must send the shared secret in the header  x-automation-key: <AUTOMATION_SECRET>
//
//   no secret configured on the server → 503 AUTOMATION_NOT_CONFIGURED (automation is off)
//   header missing or wrong            → 401 AUTOMATION_UNAUTHORIZED
//
// Why not a plain "===" comparison? It stops at the first different character, so an attacker
// could measure response times to guess the secret one character at a time ("timing attack").
// timingSafeEqual always compares everything. Hashing both first gives equal lengths.
import { createHash, timingSafeEqual } from 'node:crypto'
import { AppError } from '../utils/AppError.js'
import { automation } from '../services/automationService.js'

const digest = (text) => createHash('sha256').update(String(text)).digest()

/** True if `given` equals `expected`, compared in constant time. */
export function sameSecret(given, expected) {
  if (typeof given !== 'string' || given.length === 0 || !expected) return false
  return timingSafeEqual(digest(given), digest(expected))
}

/** getSecret: returns the current secret, or null (a function, so tests can swap the service). */
export function requireAutomationKey(getSecret = () => automation().secret) {
  return (req, res, next) => {
    const secret = getSecret()
    if (!secret) {
      throw new AppError(503, 'AUTOMATION_NOT_CONFIGURED', 'n8n automation is not configured on this server.')
    }
    if (!sameSecret(req.get('x-automation-key'), secret)) {
      throw new AppError(401, 'AUTOMATION_UNAUTHORIZED', 'Missing or wrong automation key.')
    }
    next()
  }
}
