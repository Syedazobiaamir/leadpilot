// Rate limiting (Stage 8): "at most N requests per time window, per visitor (IP address)".
// Stops one visitor from flooding the public lead form, guessing the staff password, or burning
// the Google Sheets read quota.
//
// How it works ("fixed window"): each IP gets a counter that starts at its first request and is
// reset after `windowMs`. Over `max` → 429 RATE_LIMITED with a Retry-After header (seconds).
//
// Limitations (documented): the counters live in THIS server process's memory. They reset on a
// restart, and several server instances (e.g. serverless on Vercel) each count separately.
// A shared store (e.g. Redis) would fix that; not needed for one server.
//
// Behind a proxy (Vercel), req.ip is only the real visitor's IP when Express's "trust proxy" is
// set (config.trustProxy). Otherwise every visitor would look like the proxy and share one counter.
import { AppError } from '../utils/AppError.js'
import { logger as defaultLogger } from '../utils/logger.js'

/**
 * name:     shown in logs, e.g. "lead-create"
 * windowMs: the length of a window
 * max:      allowed requests per IP per window (a function, so tests can change it)
 * key:      what to count by (default: the IP address)
 * now:      clock (tests)
 */
export function createRateLimiter({ name, windowMs, max, key = (req) => req.ip ?? 'unknown', now = Date.now, logger = defaultLogger }) {
  const limitOf = typeof max === 'function' ? max : () => max
  const counters = new Map() // key → { count, resetAt }

  function middleware(req, res, next) {
    const t = now()
    const id = key(req)
    let entry = counters.get(id)
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs }
      counters.set(id, entry)
    }
    entry.count++

    // Forget expired entries now and then, so the map can't grow forever.
    if (counters.size > 10_000) for (const [k, v] of counters) if (v.resetAt <= t) counters.delete(k)

    if (entry.count > limitOf()) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - t) / 1000))
      res.set('Retry-After', String(retryAfter))
      // Log once per window, not for every blocked request (a flood would flood the logs too).
      if (entry.count === limitOf() + 1) logger.warn('rate limit reached', { limiter: name, requestId: req.id, retryAfter })
      throw new AppError(429, 'RATE_LIMITED', `Too many requests. Please try again in ${retryAfter} seconds.`)
    }
    next()
  }

  /** Forget all counters (tests, or after changing the limit). */
  middleware.reset = () => counters.clear()
  return middleware
}
