// Every environment variable is read here, in one place.
// The rest of the code imports `config` instead of reading process.env directly,
// so it's easy to see what settings exist and what their defaults are.

function readPort(value, fallback) {
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  // Fail loudly at startup on a bad PORT instead of failing mysteriously later.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${value}". Use a whole number between 1 and 65535.`)
  }
  return port
}

const DATA_STORES = ['memory', 'sheets']

function readDataStore(value, env) {
  // SAFETY: automated tests ALWAYS use the memory store, whatever is set, so a test
  // can never write to a real spreadsheet by accident. (The opt-in Google Sheets
  // integration test builds its own store against a separate TEST sheet.)
  if (env === 'test') return 'memory'
  const store = value || 'memory'
  if (!DATA_STORES.includes(store)) {
    throw new Error(`Invalid DATA_STORE "${value}". Use one of: ${DATA_STORES.join(', ')}.`)
  }
  return store
}

/**
 * Reads and checks the Google Sheets settings. Throws ONE error that lists every
 * problem, so you can fix them all at once. The private key is never put in a message.
 * Exported so the sheets scripts and tests can use it with their own values.
 */
export function readGoogleConfig(source = process.env) {
  const problems = []

  // Accept either the ID or the whole spreadsheet URL (people often paste the URL).
  let spreadsheetId = (source.GOOGLE_SHEETS_SPREADSHEET_ID ?? '').trim()
  const fromUrl = spreadsheetId.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)
  if (fromUrl) spreadsheetId = fromUrl[1]
  if (!spreadsheetId) problems.push('GOOGLE_SHEETS_SPREADSHEET_ID is missing')
  else if (!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) {
    problems.push('GOOGLE_SHEETS_SPREADSHEET_ID does not look like a spreadsheet ID')
  }

  const clientEmail = (source.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim()
  if (!clientEmail) problems.push('GOOGLE_SERVICE_ACCOUNT_EMAIL is missing')
  else if (!clientEmail.endsWith('.gserviceaccount.com')) {
    problems.push('GOOGLE_SERVICE_ACCOUNT_EMAIL should end with .gserviceaccount.com (use the service account email, not your Gmail)')
  }

  // In .env the key is ONE line with "\n" written as two characters. Turn those back
  // into real line breaks, and remove surrounding quotes if any.
  const privateKey = (source.GOOGLE_PRIVATE_KEY ?? '').trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n')
  if (!privateKey) problems.push('GOOGLE_PRIVATE_KEY is missing')
  else if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
    problems.push('GOOGLE_PRIVATE_KEY does not look like a private key (copy the whole "private_key" value from the JSON key file)')
  }

  if (problems.length > 0) {
    throw new Error(`Google Sheets is not configured correctly:\n  - ${problems.join('\n  - ')}`)
  }
  return { spreadsheetId, clientEmail, privateKey }
}

/**
 * Reads the Gemini (AI) settings. AI is OPTIONAL: without GEMINI_API_KEY it is simply
 * disabled (returns null) and leads stay "pending". The server still runs.
 * A key that is present but malformed is an error (better to fail now than on every lead).
 * The key itself is never put in a message.
 */
export function readAiConfig(source = process.env) {
  const apiKey = (source.GEMINI_API_KEY ?? '').trim().replace(/^["']|["']$/g, '')
  if (!apiKey) return null

  const problems = []
  if (/\s/.test(apiKey) || apiKey.length < 20) {
    problems.push('GEMINI_API_KEY does not look like an API key (copy it again from Google AI Studio, with no spaces)')
  }
  const model = (source.GEMINI_MODEL ?? '').trim() || DEFAULT_GEMINI_MODEL
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(model)) {
    problems.push(`GEMINI_MODEL "${model}" is not a valid model name (example: ${DEFAULT_GEMINI_MODEL})`)
  }
  if (problems.length > 0) {
    throw new Error(`Gemini AI is not configured correctly:\n  - ${problems.join('\n  - ')}`)
  }
  return { apiKey, model }
}

/**
 * Reads the n8n automation settings (Stage 6). Automation is OPTIONAL, like AI:
 *   neither setting      → null (automation off: no events are sent, /api/automation/* answers 503)
 *   AUTOMATION_SECRET    → n8n may call /api/automation/* (with header x-automation-key)
 *   + N8N_WEBHOOK_BASE_URL → the backend also sends events to n8n
 * The secret is never put in a message.
 */
export function readAutomationConfig(source = process.env) {
  const secret = (source.AUTOMATION_SECRET ?? '').trim().replace(/^["']|["']$/g, '')
  const webhookBaseUrl = (source.N8N_WEBHOOK_BASE_URL ?? '').trim().replace(/\/+$/, '') // no trailing "/"
  if (!secret && !webhookBaseUrl) return null

  const problems = []
  if (!secret) problems.push('AUTOMATION_SECRET is missing (it is required when N8N_WEBHOOK_BASE_URL is set)')
  else if (secret.length < 32 || /\s/.test(secret)) {
    problems.push('AUTOMATION_SECRET must be at least 32 characters with no spaces (generate one: see backend/README.md)')
  }
  if (webhookBaseUrl) {
    let url = null
    try {
      url = new URL(webhookBaseUrl)
    } catch {
      // handled below
    }
    if (!url || !['http:', 'https:'].includes(url.protocol)) {
      problems.push('N8N_WEBHOOK_BASE_URL must be a full http(s) URL, e.g. http://localhost:5678/webhook')
    }
  }
  if (problems.length > 0) {
    throw new Error(`n8n automation is not configured correctly:\n  - ${problems.join('\n  - ')}`)
  }
  return { secret, webhookBaseUrl: webhookBaseUrl || null }
}

/**
 * Staff login settings (Stage 8). Both are written by `npm run auth:set-password`.
 *   STAFF_PASSWORD_HASH  the scrypt hash of the staff password (never the password itself)
 *   SESSION_SECRET       signs the login cookies (at least 32 characters, random)
 * Neither → null: login is NOT set up, and every staff-only route answers 503 (closed, never open).
 * Only one of them → an error (half a setup is a mistake). Values are never put in a message.
 */
export function readAuthConfig(source = process.env) {
  const passwordHash = (source.STAFF_PASSWORD_HASH ?? '').trim().replace(/^["']|["']$/g, '')
  const sessionSecret = (source.SESSION_SECRET ?? '').trim().replace(/^["']|["']$/g, '')
  if (!passwordHash && !sessionSecret) return null
  const problems = []
  if (!/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(passwordHash)) {
    problems.push('STAFF_PASSWORD_HASH is missing or not a scrypt hash (run "npm run auth:set-password")')
  }
  if (sessionSecret.length < 32 || /\s/.test(sessionSecret)) {
    problems.push('SESSION_SECRET is missing or shorter than 32 characters (run "npm run auth:set-password")')
  }
  if (problems.length > 0) throw new Error(`Staff login is not configured correctly:\n  - ${problems.join('\n  - ')}`)
  return { passwordHash, sessionSecret }
}

/**
 * TRUST_PROXY (Stage 8): how many proxies sit in front of this server. Empty = none (local).
 * On Vercel/behind one load balancer use 1, so req.ip is the VISITOR's IP (rate limits need it).
 * Never trust more proxies than really exist: visitors could then fake their IP.
 */
export function readTrustProxy(value) {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (!/^[0-9]$/.test(text)) throw new Error(`Invalid TRUST_PROXY "${value}". Use a number of proxies (e.g. 1), or leave it empty.`)
  return Number(text)
}

// Fast, low-cost model. Checked against the models your key can use with "npm run ai:check".
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

const env = process.env.NODE_ENV || 'development'
const dataStore = readDataStore(process.env.DATA_STORE, env)

export const config = {
  port: readPort(process.env.PORT, 3001),
  env,
  // Logs are off during tests (Vitest sets NODE_ENV=test) so test output stays readable.
  logLevel: process.env.LOG_LEVEL || (env === 'test' ? 'silent' : 'info'),
  // Where data is kept: 'memory' (sample data, resets on restart) or 'sheets' (Google Sheets)
  dataStore,
  // Only read (and required) when Google Sheets is the active store.
  google: dataStore === 'sheets' ? readGoogleConfig() : null,
  // How long Sheets reads are cached (ms). Google allows ~60 reads/minute.
  sheetsCacheMs: 10_000,
  // Give up on a Google request after this long (ms).
  // TIMEOUT BUDGET: must be SHORTER than the frontend's 10s timeout (frontend/src/services/leadService.js),
  // so the backend's clear 503 reaches the browser before the browser gives up on its own.
  sheetsTimeoutMs: 8_000,
  // Gemini settings, or null when AI is disabled.
  // SAFETY: automated tests ALWAYS have AI disabled, so a test can never call the real (paid/limited) API.
  ai: env === 'test' ? null : readAiConfig(),
  // Give up on a Gemini request after this long (ms). AI calls always run in the background,
  // so this doesn't count against the frontend's 10s budget; it just stops a stuck call.
  aiTimeoutMs: 6_000,
  // The business name used to sign follow-up drafts (Stage 5). A FICTIONAL demo name by default.
  contractorName: (process.env.CONTRACTOR_NAME ?? '').trim() || 'LeadPilot Demo Contracting',
  // n8n automation settings (Stage 6), or null when automation is off.
  // SAFETY: automated tests ALWAYS have it off (tests inject a fake), so no test can reach a real n8n.
  automation: env === 'test' ? null : readAutomationConfig(),
  // Give up on sending an event to n8n after this long (ms). Events are sent in the background.
  automationTimeoutMs: 5_000,
  // Stage 8 security ---------------------------------------------------------
  trustProxy: readTrustProxy(process.env.TRUST_PROXY),
  // Staff login, or null when not set up. SAFETY: tests inject their own (useAuthForTests).
  auth: env === 'test' ? null : readAuthConfig(),
  // Requests per IP. Tests get very high limits (a test that checks a limit lowers it on purpose).
  rateLimits: {
    leadCreatePerMinute: env === 'test' ? 10_000 : 10, // the public lead form
    loginPer15Minutes: env === 'test' ? 10_000 : 5, // password guesses
  },
  // GET /api/health/ready is reused for this long: each real check costs 7 Google Sheets reads
  // (one per tab), and Google allows ~60 reads/minute. 0 in tests.
  readyCacheMs: env === 'test' ? 0 : 30_000,
}
