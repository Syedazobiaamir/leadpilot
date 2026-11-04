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

/**
 * Sends a request and returns the parsed JSON body.
 * Every kind of failure becomes an ApiError with a clear message:
 * network down, timeout, error response, or a response we can't read.
 */
async function request(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
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

/**
 * Creates a lead. The return shape is unchanged from Stage 1, so the form needs no changes:
 *   { success: true, lead }  or  { success: false, errors: { field: message } | { form: message } }
 * The server is the final judge: it validates again and checks for duplicates.
 */
export async function createLead(input) {
  try {
    const body = await request('/leads', { method: 'POST', body: input })
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
