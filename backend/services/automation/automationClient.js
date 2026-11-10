// The ONLY file that sends anything to n8n (Stage 6). Plain fetch, like geminiClient.js.
//
//   POST <N8N_WEBHOOK_BASE_URL>/<event path>     e.g. http://localhost:5678/webhook/followup-approved
//   header x-automation-key: <AUTOMATION_SECRET>  (n8n checks it, so nobody else can trigger our workflows)
//   body   { id, type, occurredAt, data }          the "event envelope"
//
// Every failure becomes an AutomationError with a "kind" and a "temporary" flag
// (same idea as StorageError and AiError; see the api-integration skill).
import { randomUUID } from 'node:crypto'

// Event type → the path of the n8n Webhook node that receives it.
// Only these events exist. Nothing else can be sent to n8n.
export const EVENT_PATHS = {
  'lead.qualified': 'lead-qualified', // a lead was qualified as Hot → WF1 dashboard alert
  'followup.approved': 'followup-approved', // a person approved a draft → WF2 sends it (SIMULATED)
}

/**
 * Sending an event failed.
 * kind: timeout | unreachable | not_found | auth | rejected | server_error | bad_event
 * temporary: true if trying again later may work (n8n down, slow, or erroring).
 * Never contains the secret or the response body.
 */
export class AutomationError extends Error {
  constructor(kind, message, { temporary = false, httpStatus = null } = {}) {
    super(message)
    this.name = 'AutomationError'
    this.kind = kind
    this.temporary = temporary
    this.httpStatus = httpStatus
  }
}

/** Turns an n8n HTTP error status into an AutomationError. */
export function describeN8nError(httpStatus) {
  const make = (kind, message, temporary) => new AutomationError(kind, message, { temporary, httpStatus })
  if (httpStatus === 404) {
    // n8n answers 404 when no ACTIVE workflow listens on that path.
    return make('not_found', 'n8n has no active workflow for this event (is the workflow activated?)', false)
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return make('auth', 'n8n rejected the automation key (AUTOMATION_SECRET differs between the backend and n8n)', false)
  }
  if (httpStatus >= 500) return make('server_error', `n8n answered ${httpStatus} (the workflow failed or n8n is overloaded)`, true)
  return make('rejected', `n8n rejected the event (HTTP ${httpStatus})`, false)
}

/**
 * baseUrl:   N8N_WEBHOOK_BASE_URL, e.g. http://localhost:5678/webhook
 * secret:    AUTOMATION_SECRET
 * timeoutMs: our own deadline for one event
 * fetchImpl: tests pass a fake, so no test ever reaches the network
 */
export function createAutomationClient({ baseUrl, secret, timeoutMs = 5_000, fetchImpl = fetch, now = () => new Date() }) {
  /** Sends one event. Resolves { eventId, httpStatus } on success, throws AutomationError otherwise. */
  async function send(type, data) {
    const path = EVENT_PATHS[type]
    if (!path) throw new AutomationError('bad_event', `Unknown event type "${type}"`)
    const event = { id: `EVT-${randomUUID()}`, type, occurredAt: now().toISOString(), data }

    // The deadline both CANCELS the request and, as a backup, stops waiting (like geminiClient).
    const controller = new AbortController()
    let timer
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new AutomationError('timeout', `n8n did not answer within ${timeoutMs / 1000}s`, { temporary: true }))
      }, timeoutMs)
    })

    const call = (async () => {
      let res
      try {
        res = await fetchImpl(`${baseUrl}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-automation-key': secret },
          body: JSON.stringify(event),
          signal: controller.signal,
        })
      } catch {
        // fetch only throws when no answer arrives at all (n8n not running, wrong host/port...).
        // The original error is discarded on purpose (see the api-integration skill).
        throw new AutomationError('unreachable', `Could not reach n8n at ${new URL(baseUrl).host} (is n8n running?)`, { temporary: true })
      }
      // We don't need n8n's answer body, only whether it accepted the event.
      if (!res.ok) throw describeN8nError(res.status)
      return { eventId: event.id, httpStatus: res.status }
    })()

    try {
      return await Promise.race([call, deadline])
    } finally {
      clearTimeout(timer)
    }
  }

  return { send }
}
