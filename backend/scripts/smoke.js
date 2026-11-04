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
  check('Unknown lead → 404 LEAD_NOT_FOUND', (await call('/api/leads/LD-999999')).json?.error?.code === 'LEAD_NOT_FOUND')
  check('Malformed ID → 400 INVALID_LEAD_ID', (await call('/api/leads/abc')).json?.error?.code === 'INVALID_LEAD_ID')
  check('Unknown route → 404 NOT_FOUND', (await call('/api/nope')).json?.error?.code === 'NOT_FOUND')

  // --- Create
  const created = await call('/api/leads', { method: 'POST', body: { ...lead, status: 'Won', classification: 'Hot' } })
  const newId = created.json?.data?.id
  check('POST valid lead → 201', created.status === 201, `status=${created.status} id=${newId}`)
  check('Client cannot set status/classification', created.json?.data?.status === 'New' && created.json?.data?.classification === null)
  check('Location header points to new lead', created.headers.get('location') === `/api/leads/${newId}`)
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
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  // Usually means a server isn't running. Say so clearly instead of showing a long stack trace.
  console.error(`\nSMOKE TEST COULD NOT RUN: ${err.cause?.code ?? err.message}`)
  console.error(`Is the app running at ${BASE}? Start the backend (and the frontend for port 5173) first.`)
  process.exit(1)
})
