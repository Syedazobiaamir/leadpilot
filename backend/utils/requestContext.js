// Request context (Stage 8): "which request is this code working for?" — without passing the
// request ID through every function by hand.
//
// AsyncLocalStorage (built into Node) is like a pocket that travels with one request: the
// requestId middleware puts the ID in, and ANY code that runs for that request (services, the
// Sheets store, even background work it starts) can read it. The logger adds it to every line,
// so all log lines of one request can be found together.
import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage()

/** Runs `fn` with this context (e.g. { requestId }). Everything `fn` starts can read it. */
export function runWithRequestContext(context, fn) {
  return storage.run(context, fn)
}

/** The current request's context, or undefined outside a request (e.g. a script). */
export function getRequestContext() {
  return storage.getStore()
}
