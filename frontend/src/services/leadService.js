// The data access layer: the ONLY frontend file that talks to the backend API.
// Components and hooks call these functions and never use fetch() themselves.
//
// In development, Vite forwards "/api/..." to the Express server on port 3001
// (see vite.config.js), so the browser only ever talks to one address.
// VITE_API_URL can point somewhere else later, e.g. the deployed API in Stage 9.
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'
const TIMEOUT_MS = 10_000

/** An error from the API, with the same code/details/requestId the backend sends. */
export class ApiError extends Error {
  constructor(message, { status = null, code = 'UNKNOWN_ERROR', details, requestId } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

// Stage 8: fired when the server says "you are not logged in" (session expired, password changed,
// or never logged in). The login gate (hooks/useAuth.js) listens and shows the login page.
export const SESSION_ENDED_EVENT = 'leadpilot:session-ended'

/**
 * Sends a request and returns the parsed JSON body.
 * Every kind of failure becomes an ApiError with a clear message:
 * network down, timeout, error response, or a response we can't read.
 */
async function request(path, { method = 'GET', body, headers = {} } = {}) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Give up after 10 seconds instead of waiting forever.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new ApiError('The server took too long to respond. Please try again.', { code: 'TIMEOUT' })
    }
    // fetch() itself only fails when no response arrives at all (server down, no internet).
    throw new ApiError('Could not reach the server. Check that the backend is running.', { code: 'NETWORK_ERROR' })
  }

  // Read the body as JSON. If it isn't JSON, data stays null.
  let data = null
  try {
    data = await res.json()
  } catch {
    // e.g. an HTML error page or an empty body. Handled below.
  }

  if (!res.ok) {
    const apiError = data?.error
    if (!apiError) {
      // Not our API's error format. Usually a proxy error because the backend is down.
      throw new ApiError(`Could not reach the server (HTTP ${res.status}). Check that the backend is running.`, {
        status: res.status,
        code: 'BAD_GATEWAY',
      })
    }
    if (res.status === 401 && apiError.code === 'NOT_LOGGED_IN') window.dispatchEvent(new Event(SESSION_ENDED_EVENT))
    throw new ApiError(apiError.message, {
      status: res.status,
      code: apiError.code,
      details: apiError.details,
      requestId: apiError.requestId,
    })
  }

  if (data === null) {
    throw new ApiError('The server sent a response that could not be read.', { status: res.status, code: 'BAD_RESPONSE' })
  }
  return data
}

// While a lead is being qualified by AI (in the background on the server), the app re-fetches
// the leads every POLL ms, for at most WATCH ms. Faster in tests so they don't wait.
export const QUALIFICATION_POLL_MS = import.meta.env.MODE === 'test' ? 30 : 3_000
export const QUALIFICATION_WATCH_MS = import.meta.env.MODE === 'test' ? 300 : 60_000

/** All leads, newest first (sorted by the server). */
export async function getLeads() {
  return (await request('/leads')).data
}

/** Activity events, newest first. */
export async function getActivity() {
  return (await request('/activity')).data
}

/** Workflow runs, newest first. */
export async function getWorkflowRuns() {
  return (await request('/workflow-runs')).data
}

/** Agent runs (Stage 5): the REAL record of what each agent did, newest first. */
/** Stage 7: self-healing records (what the Recovery Agent is fixing, fixed, or escalated). */
export async function getRecoveries() {
  return (await request('/recoveries')).data
}

export async function getAgentRuns() {
  return (await request('/agent-runs')).data
}

// ---- Follow-up drafts (Stage 5) --------------------------------------------------------
// Every function returns { success: true, ... } or { success: false, code, error, details? }
// so the UI can show the server's own message (e.g. "already approved").

async function attempt(work) {
  try {
    return { success: true, ...(await work()) }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    return { success: false, code: err.code, error: err.message, details: err.details }
  }
}

/** The follow-up drafts of one lead, newest first. */
export const getFollowUps = (leadId) =>
  attempt(async () => ({ followUps: (await request(`/leads/${encodeURIComponent(leadId)}/followups`)).data }))

/** Asks the Follow-up Agent for a new draft (202: it is written in the background). */
export const requestFollowUp = (leadId) =>
  attempt(async () => ({ request: (await request(`/leads/${encodeURIComponent(leadId)}/followups`, { method: 'POST' })).data }))

/** A PERSON approves a draft. Nothing is sent here: n8n sends it afterwards (Stage 6, SIMULATED). */
export const approveFollowUp = (id) =>
  attempt(async () => ({ followUp: (await request(`/followups/${encodeURIComponent(id)}/approve`, { method: 'POST' })).data }))

export const rejectFollowUp = (id) =>
  attempt(async () => ({ followUp: (await request(`/followups/${encodeURIComponent(id)}/reject`, { method: 'POST' })).data }))

export const editFollowUp = (id, changes) =>
  attempt(async () => ({ followUp: (await request(`/followups/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes })).data }))

/**
 * Asks the server to (re)qualify a lead with AI. The server answers 202 right away with the
 * lead marked "pending"; the AI result appears on the lead a few seconds later.
 * Returns { success: true, lead } or { success: false, code, error } (e.g. AI_UNAVAILABLE).
 */
export async function requalifyLead(id) {
  try {
    const body = await request(`/leads/${encodeURIComponent(id)}/qualify`, { method: 'POST' })
    return { success: true, lead: body.data }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    return { success: false, code: err.code, error: err.message }
  }
}

/**
 * Creates a lead. The return shape is unchanged from Stage 1, so the form needs no changes:
 *   { success: true, lead }  or  { success: false, errors: { field: message } | { form: message } }
 * The server is the final judge: it validates again and checks for duplicates.
 */
/**
 * idempotencyKey (Stage 7): the same random key for every try of ONE form submission. If an earlier
 * try did reach the server (only the answer was lost), the server returns that lead again
 * instead of creating a second one or answering "duplicate".
 */
export async function createLead(input, { idempotencyKey } = {}) {
  try {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
    const body = await request('/leads', { method: 'POST', body: input, headers })
    return { success: true, lead: body.data }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err

    // Field errors from the server appear under the matching inputs.
    if (err.code === 'VALIDATION_ERROR' && err.details) {
      return { success: false, errors: err.details }
    }
    // For server-side failures, show a reference so support can find it in the logs.
    const reference = err.status >= 500 && err.requestId ? ` (reference: ${err.requestId.slice(0, 8)})` : ''
    return { success: false, errors: { form: err.message + reference } }
  }
}

// ---- Staff login (Stage 8) ---------------------------------------------------------------
// The session lives in an HttpOnly cookie: the browser stores it and sends it with every /api
// request by itself. This code never sees or touches the token.

/** { configured, loggedIn, expiresAt }. Throws ApiError if the server can't be reached. */
export async function getSession() {
  return (await request('/auth/session')).data
}

/** Returns { success: true } or { success: false, code, error } (wrong password, too many tries...). */
export async function loginStaff(password) {
  try {
    await request('/auth/login', { method: 'POST', body: { password } })
    return { success: true }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    return { success: false, code: err.code, error: err.message }
  }
}

export async function logoutStaff() {
  await request('/auth/logout', { method: 'POST' })
}

/** Stage 8: the operational report (counts only, staff only). */
export async function getReport() {
  return (await request('/reports/overview')).data
}
