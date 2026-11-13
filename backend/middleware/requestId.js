// Gives every request a unique ID and returns it in the "X-Request-Id" response header.
// Every log line and error response includes this ID, so one request can be
// traced from start to finish. That's the foundation for debugging and self-healing.
import { randomUUID } from 'node:crypto'
import { runWithRequestContext } from '../utils/requestContext.js'

// Only accept a caller's ID if it looks safe (letters, digits, - and _, max 64 chars).
// Otherwise anyone could inject odd text into our logs.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id')
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID()
  res.set('X-Request-Id', req.id)
  // Stage 8: everything that runs for this request can now find its ID (the logger adds it).
  runWithRequestContext({ requestId: req.id }, () => next()) // pass control to the next middleware
}
