// The app's rate limiters, in one place (Stage 8). Limits are numbers in `limits`, read on every
// request, so tests can lower them (tests otherwise get very high limits: see config.js).
import { config } from '../config.js'
import { createRateLimiter } from './rateLimit.js'

export const limits = { ...config.rateLimits }

/** POST /api/leads (the PUBLIC form): stops one visitor from flooding the lead list. */
export const leadCreateLimiter = createRateLimiter({ name: 'lead-create', windowMs: 60_000, max: () => limits.leadCreatePerMinute })

/** POST /api/auth/login: stops password guessing (5 tries per 15 minutes per IP). */
export const loginLimiter = createRateLimiter({ name: 'login', windowMs: 15 * 60_000, max: () => limits.loginPer15Minutes })

/** TESTS ONLY: set limits and clear all counters. */
export function useLimitsForTests(changes = {}) {
  Object.assign(limits, config.rateLimits, changes)
  leadCreateLimiter.reset()
  loginLimiter.reset()
}
