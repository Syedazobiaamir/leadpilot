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
}
