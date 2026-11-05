// Command-line entry for the Google Sheets helpers. Reads settings from backend/.env.
//
//   npm run sheets:check               check the connection, permissions, tabs and headers (read-only)
//   npm run sheets:setup               create missing tabs and header rows
//   npm run sheets:setup -- --seed     ...and add the SIMULATED sample data to empty tabs
//
// The private key is never printed.
import { readGoogleConfig } from '../config.js'
import { createSheetsClient, StorageError } from '../services/stores/sheetsClient.js'
import { checkSheets, setupSheets, FIX_HINTS } from './sheetsAdmin.js'

const command = process.argv[2]
const seed = process.argv.includes('--seed')

async function main() {
  if (!['check', 'setup'].includes(command)) {
    console.error('Usage: node scripts/sheets.js check | setup [--seed]')
    return false
  }

  let google
  try {
    google = readGoogleConfig()
  } catch (err) {
    console.error(`\n${err.message}\n\nFill these in backend/.env (see docs/google-sheets-setup.md).`)
    return false
  }

  const client = createSheetsClient({ ...google, timeoutMs: 15_000 })

  if (command === 'check') {
    return checkSheets({ client, serviceAccountEmail: google.clientEmail })
  }

  try {
    return await setupSheets({ client, seed })
  } catch (err) {
    console.error(`\nSetup failed: ${err.message}`)
    if (err instanceof StorageError) console.error(`Fix: ${FIX_HINTS[err.kind] ?? FIX_HINTS.unknown}`)
    console.error('Tip: run "npm run sheets:check" for a step-by-step diagnosis.')
    return false
  }
}

// Set the exit code (0 = success, 1 = failure) and let Node finish by itself
// (process.exit() can crash Node on Windows while network connections are closing).
main().then((ok) => {
  process.exitCode = ok ? 0 : 1
})
