// Background work on Vercel (Stage 9).
//
// Our API answers FIRST and does slow work (AI qualification, follow-up drafts, n8n events)
// AFTER the answer, in the background. On a normal server that's fine: the process keeps running.
// On Vercel (serverless), the function may be FROZEN as soon as the answer is sent, so an
// unfinished background job could stop halfway.
//
// waitUntil(promise) tells Vercel: "the answer is sent, but keep this function alive until
// this promise finishes" (up to the function's maxDuration, see vercel.json).
// Outside Vercel (local server, tests, scripts) waitUntil does nothing, so behaviour there is unchanged.
import { waitUntil } from '@vercel/functions'
import { logger } from './logger.js'

/** Keeps the function alive until `promise` settles (Vercel only). Returns the same promise. Never throws. */
export function keepAlive(promise) {
  try {
    // The promise passed to Vercel must not reject (an unhandled rejection is logged as an error),
    // so it gets a version that always resolves. Callers still get the original promise.
    waitUntil(Promise.resolve(promise).catch(() => {}))
  } catch (err) {
    // Never let the helper break the real work.
    logger.warn('could not register background work', { error: err.message })
  }
  return promise
}
