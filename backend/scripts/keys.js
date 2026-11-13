// Key rotation helpers (Stage 8). They write NEW keys into backend/.env without ever printing them.
//
//   npm run keys:import-google -- "C:\path\to\downloaded-key.json"
//       Reads a NEW Google service-account key file and writes GOOGLE_SERVICE_ACCOUNT_EMAIL and
//       GOOGLE_PRIVATE_KEY (one line, \n kept as written). Shows only the key ID's first characters,
//       so you can see it is a different key. Delete the JSON file afterwards.
//
//   npm run keys:set-gemini
//       Asks for the NEW Gemini API key (typing shows only "*") and writes GEMINI_API_KEY.
//       Run it in your own terminal.
//
// Then restart the backend and check: npm run sheets:check · npm run ai:check
import { readFileSync, existsSync } from 'node:fs'
import { askHidden, readEnv, setEnvLine, writeEnv } from './envFile.js'

const OLD_GOOGLE_KEY_ID_PREFIX = '45ee26ba6d64' // the key that was exposed in a chat on 2026-11-05

function importGoogleKey(path) {
  if (!path) throw new Error('Give the path of the downloaded JSON key file, e.g.: npm run keys:import-google -- "C:\\Users\\you\\Downloads\\key.json"')
  if (!existsSync(path)) throw new Error(`File not found: ${path}`)
  let key
  try {
    key = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('That file is not valid JSON. Download the key again (Keys → Add key → Create new key → JSON).')
  }
  const problems = []
  if (key.type !== 'service_account') problems.push('it is not a service-account key ("type" should be "service_account")')
  if (!String(key.client_email ?? '').endsWith('.gserviceaccount.com')) problems.push('"client_email" is missing or not a service account email')
  if (!String(key.private_key ?? '').includes('-----BEGIN PRIVATE KEY-----')) problems.push('"private_key" is missing')
  if (problems.length > 0) throw new Error(`This doesn't look like the right key file: ${problems.join('; ')}. Nothing was changed.`)

  const keyId = String(key.private_key_id ?? '')
  if (keyId.startsWith(OLD_GOOGLE_KEY_ID_PREFIX)) {
    throw new Error('This is the OLD key (the one that was exposed). Create a NEW key in Google Cloud. Nothing was changed.')
  }

  let env = readEnv()
  env = setEnvLine(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL', key.client_email)
  // One line in .env: real line breaks become the two characters "\n" (config.js turns them back).
  env = setEnvLine(env, 'GOOGLE_PRIVATE_KEY', `"${key.private_key.replace(/\r?\n/g, '\\n')}"`)
  writeEnv(env)
  console.log(`Done. The new key (ID ${keyId.slice(0, 6)}…) for ${key.client_email} is in backend/.env.`)
  console.log('Next: 1) restart the backend  2) npm run sheets:check  3) delete the OLD key in Google Cloud  4) delete the downloaded JSON file.')
}

async function setGeminiKey() {
  console.log('Paste the NEW Gemini API key (from Google AI Studio). It will show as *.')
  const apiKey = (await askHidden('New Gemini API key: ')).trim()
  if (apiKey.length < 20 || /\s/.test(apiKey)) throw new Error('That does not look like an API key. Nothing was changed.')
  const old = (readEnv().match(/^GEMINI_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
  if (apiKey === old) throw new Error('That is the SAME key as before. Create a new one in AI Studio. Nothing was changed.')
  writeEnv(setEnvLine(readEnv(), 'GEMINI_API_KEY', apiKey))
  console.log('Done. The new Gemini key is in backend/.env.')
  console.log('Next: 1) restart the backend  2) npm run ai:check  3) delete the OLD key in Google AI Studio.')
}

const [command, arg] = process.argv.slice(2)
const run = { 'import-google': () => importGoogleKey(arg), 'set-gemini': setGeminiKey }[command]
if (!run) {
  console.error('Usage: npm run keys:import-google -- "<path to key.json>"   |   npm run keys:set-gemini')
  process.exit(1)
}
Promise.resolve()
  .then(run)
  .catch((err) => {
    console.error(`\n${err.message}`)
    process.exit(1)
  })
