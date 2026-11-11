// End-to-end smoke test: sends real HTTP requests to a running app and prints PASS/FAIL.
//
// Usage (with the backend AND the frontend dev servers running):
//   npm run smoke                          # through the Vite proxy, like the browser
//   npm run smoke -- http://localhost:3001 # straight to the API (skips the app page check)
//
// ⚠ It CREATES one test lead per run. Only run it against local or demo data,
//   never against a deployment holding real customer data.
const BASE = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '')
const viaFrontend = !BASE.endsWith(':3001')
let failures = 0

function check(name, condition, info = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`)
  if (!condition) failures++
}

async function call(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    // not JSON; the checks below will report it
  }
  return { status: res.status, headers: res.headers, json }
}

// A unique, fictional lead for each run (555-01xx numbers are reserved for fiction).
const stamp = Date.now()
const areaCode = 200 + (stamp % 800)
const lineNumber = String(stamp % 100).padStart(2, '0')
const lead = {
  name: 'Smoke Test',
  phone: `${areaCode}-555-01${lineNumber}`,
  email: `smoke.${stamp}@example.com`,
  zip: '78702',
  serviceType: 'Siding',
  timeline: 'Within 1 month',
  message: 'Automated smoke test lead. Safe to ignore.',
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`)

  if (viaFrontend) {
    const page = await fetch(BASE + '/')
    check('App page loads', page.status === 200 && (await page.text()).includes('<title>LeadPilot</title>'))
  }

  // --- Read endpoints
  const health = await call('/api/health')
  check('Health check ok', health.status === 200 && health.json?.status === 'ok')

  const before = await call('/api/leads')
  const startCount = before.json?.count
  check('GET /api/leads returns a list', before.status === 200 && Array.isArray(before.json?.data), `count=${startCount}`)
  check('GET /api/activity works', (await call('/api/activity')).status === 200)
  check('GET /api/workflow-runs works', (await call('/api/workflow-runs')).status === 200)
  check('GET /api/recoveries works (Stage 7)', Array.isArray((await call('/api/recoveries')).json?.data))
  check('Unknown lead → 404 LEAD_NOT_FOUND', (await call('/api/leads/LD-999999')).json?.error?.code === 'LEAD_NOT_FOUND')
  check('Malformed ID → 400 INVALID_LEAD_ID', (await call('/api/leads/abc')).json?.error?.code === 'INVALID_LEAD_ID')
  check('Unknown route → 404 NOT_FOUND', (await call('/api/nope')).json?.error?.code === 'NOT_FOUND')

  // --- Stage 6: n8n-only endpoints must refuse anyone without the automation key
  check('Health reports automation (n8n or disabled)', ['n8n', 'disabled'].includes(health.json?.automation), `automation=${health.json?.automation}`)
  const noKey = await call('/api/automation/check')
  check('/api/automation/* without key → 401 (or 503 when automation is off)',
    ['AUTOMATION_UNAUTHORIZED', 'AUTOMATION_NOT_CONFIGURED'].includes(noKey.json?.error?.code), `status=${noKey.status}`)
  const wrongKey = await call('/api/automation/workflow-runs', { method: 'POST', body: {}, headers: { 'x-automation-key': 'guess' } })
  check('/api/automation/* with a wrong key is refused', wrongKey.status === 401 || wrongKey.status === 503, `status=${wrongKey.status}`)

  // --- Create
  const key = `smoke-${stamp}` // Stage 7: Idempotency-Key, so a retried submission returns the same lead
  const created = await call('/api/leads', { method: 'POST', body: { ...lead, status: 'Won', classification: 'Hot' }, headers: { 'Idempotency-Key': key } })
  const newId = created.json?.data?.id
  check('POST valid lead → 201', created.status === 201, `status=${created.status} id=${newId}`)
  check('Client cannot set status/classification', created.json?.data?.status === 'New' && created.json?.data?.classification === null)
  check('Location header points to new lead', created.headers.get('location') === `/api/leads/${newId}`)
  const replay = await call('/api/leads', { method: 'POST', body: lead, headers: { 'Idempotency-Key': key } })
  check('Same Idempotency-Key again → 201 replay of the SAME lead (no duplicate)',
    replay.status === 201 && replay.headers.get('idempotent-replayed') === 'true' && replay.json?.data?.id === newId, `status=${replay.status}`)
  check('The API never shows the idempotency key', !JSON.stringify(created.json).includes(key))
  check('GET /api/leads/:id finds the new lead', (await call(`/api/leads/${newId}`)).status === 200)
  const activity = await call('/api/activity')
  const event = activity.json?.data?.find((e) => e.leadId === newId)
  check('Audit event written for new lead', Boolean(event))
  check('Audit event contains no personal data', event && !event.message.includes(lead.email) && !event.message.includes('Smoke Test'))

  // --- Rejections (none of these may create a lead)
  const dupEmail = await call('/api/leads', { method: 'POST', body: { ...lead, email: lead.email.toUpperCase(), phone: '212-555-0100' } })
  check('Duplicate email (different case) → 409', dupEmail.status === 409 && dupEmail.json?.error?.code === 'DUPLICATE_LEAD')
  const dupPhone = await call('/api/leads', { method: 'POST', body: { ...lead, email: `other.${stamp}@example.com`, phone: `+1 (${areaCode}) 555-01${lineNumber}` } })
  check('Duplicate phone (different format) → 409', dupPhone.status === 409)
  const invalid = await call('/api/leads', { method: 'POST', body: { ...lead, zip: '9021', email: 'abc' } })
  check('Invalid ZIP + email → 400 with both field errors', invalid.status === 400 && Boolean(invalid.json?.error?.details?.zip && invalid.json?.error?.details?.email))
  const missing = await call('/api/leads', { method: 'POST', body: { name: 'Tom' } })
  check('Missing fields → readable "is required" messages', missing.json?.error?.details?.phone === 'Phone number is required')
  check('Broken JSON → 400 INVALID_JSON', (await call('/api/leads', { method: 'POST', raw: '{"name":' })).json?.error?.code === 'INVALID_JSON')
  const big = await call('/api/leads', { method: 'POST', body: { ...lead, message: 'x'.repeat(12000) } })
  check('Body over 10kb → 413 PAYLOAD_TOO_LARGE', big.status === 413 && big.json?.error?.code === 'PAYLOAD_TOO_LARGE')
  const after = await call('/api/leads')
  check('Exactly one lead was added', after.json?.count === startCount + 1, `${startCount} → ${after.json?.count}`)

  // --- Tracing & safety
  const traced = await call('/api/health', { headers: { 'X-Request-Id': `smoke-${stamp}` } })
  check('X-Request-Id is passed through', traced.headers.get('x-request-id') === `smoke-${stamp}`)
  check('X-Powered-By header hidden', traced.headers.get('x-powered-by') === null)
  check('Error responses include requestId', typeof invalid.json?.error?.requestId === 'string')

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  // Set the exit code instead of calling process.exit(). Node then finishes on its own
  // once open network connections close. Calling process.exit() while fetch connections
  // are closing can crash Node on Windows ("Assertion failed ... UV_HANDLE_CLOSING").
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((err) => {
  // Usually means a server isn't running. Say so clearly instead of showing a long stack trace.
  console.error(`\nSMOKE TEST COULD NOT RUN: ${err.cause?.code ?? err.message}`)
  console.error(`Is the app running at ${BASE}? Start the backend (and the frontend for port 5173) first.`)
  process.exitCode = 1
})
