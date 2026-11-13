// Staff login setup (Stage 8).
//
//   npm run auth:set-password
//
// Asks for the staff password TWICE (typing shows only "*"), then writes to backend/.env:
//   STAFF_PASSWORD_HASH=<scrypt hash>   (replaces an old one: every old login session ends)
//   SESSION_SECRET=<random>             (only created if missing)
// The password itself is never stored, printed or logged. Restart the backend afterwards.
//
// Run it in YOUR OWN terminal (PowerShell, VS Code): it needs a real keyboard to hide the typing.
import { randomBytes } from 'node:crypto'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../services/authService.js'
import { askHidden, readEnv, setEnvLine, writeEnv } from './envFile.js'

async function setPassword() {
  console.log('Set the LeadPilot staff password.')
  console.log(`Use at least ${MIN_PASSWORD_LENGTH} characters. A short sentence is easy to remember and hard to guess.\n`)
  const first = await askHidden('New staff password: ')
  if (first.length < MIN_PASSWORD_LENGTH) throw new Error(`Too short: use at least ${MIN_PASSWORD_LENGTH} characters. Nothing was changed.`)
  if (first.length > 200) throw new Error('Too long (max 200 characters). Nothing was changed.')
  const second = await askHidden('Type it again: ')
  if (first !== second) throw new Error('The two passwords are different. Nothing was changed.')

  let env = readEnv()
  const hadSecret = /^SESSION_SECRET=.{32,}$/m.test(env)
  if (!/^# --- Staff login/m.test(env)) env = `${env}${env.endsWith('\n') || env === '' ? '' : '\n'}\n# --- Staff login (Stage 8). Written by "npm run auth:set-password". SECRET: never commit or share.\n`
  env = setEnvLine(env, 'STAFF_PASSWORD_HASH', hashPassword(first))
  if (!hadSecret) env = setEnvLine(env, 'SESSION_SECRET', randomBytes(48).toString('base64url'))
  writeEnv(env)

  console.log('\nDone. The password HASH was saved in backend/.env (the password itself is not stored anywhere).')
  if (!hadSecret) console.log('A new SESSION_SECRET was created as well.')
  console.log('Restart the backend (npm run dev) so it uses the new password. Any old login sessions have ended.')
}

const command = process.argv[2]
if (command !== 'set-password') {
  console.error('Usage: npm run auth:set-password')
  process.exit(1)
}
setPassword().catch((err) => {
  console.error(`\n${err.message}`)
  process.exit(1)
})
