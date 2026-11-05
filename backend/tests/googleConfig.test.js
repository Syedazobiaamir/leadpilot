import { describe, expect, it } from 'vitest'
import { readGoogleConfig } from '../config.js'
import { createLogger } from '../utils/logger.js'

// A FAKE key in the right format. It is not a real credential.
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n'
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab'

const valid = {
  GOOGLE_SHEETS_SPREADSHEET_ID: ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'leadpilot@leadpilot-123.iam.gserviceaccount.com',
  // How it looks in .env: ONE line, line breaks written as \n
  GOOGLE_PRIVATE_KEY: FAKE_KEY.replace(/\n/g, '\\n'),
}

describe('readGoogleConfig', () => {
  it('reads valid settings and turns "\\n" back into real line breaks', () => {
    const config = readGoogleConfig(valid)
    expect(config.spreadsheetId).toBe(ID)
    expect(config.privateKey).toBe(FAKE_KEY)
  })

  it('accepts the whole spreadsheet URL and extracts the ID', () => {
    const url = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`
    expect(readGoogleConfig({ ...valid, GOOGLE_SHEETS_SPREADSHEET_ID: url }).spreadsheetId).toBe(ID)
  })

  it('removes quotes around the key', () => {
    const quoted = `"${valid.GOOGLE_PRIVATE_KEY}"`
    expect(readGoogleConfig({ ...valid, GOOGLE_PRIVATE_KEY: quoted }).privateKey).toBe(FAKE_KEY)
  })

  it('lists ALL problems at once', () => {
    expect(() => readGoogleConfig({})).toThrow(
      /SPREADSHEET_ID is missing[\s\S]*SERVICE_ACCOUNT_EMAIL is missing[\s\S]*PRIVATE_KEY is missing/,
    )
  })

  it('catches a Gmail address used instead of the service account email', () => {
    expect(() => readGoogleConfig({ ...valid, GOOGLE_SERVICE_ACCOUNT_EMAIL: 'me@gmail.com' })).toThrow(/gserviceaccount\.com/)
  })

  it('catches a key that is only part of the JSON value', () => {
    expect(() => readGoogleConfig({ ...valid, GOOGLE_PRIVATE_KEY: 'FAKEFAKEFAKE' })).toThrow(/does not look like a private key/)
  })

  it('never puts the key in an error message', () => {
    const partialKey = '-----BEGIN PRIVATE KEY-----\\nSECRETPART'
    const error = (() => {
      try {
        readGoogleConfig({ ...valid, GOOGLE_PRIVATE_KEY: partialKey })
      } catch (e) {
        return e
      }
    })()
    expect(error.message).not.toMatch(/SECRETPART/)
  })
})

describe('logger redaction', () => {
  it('redacts privateKey and credentials fields', () => {
    const lines = []
    const log = createLogger({ level: 'info', output: (l) => lines.push(l) })
    log.info('config', { privateKey: FAKE_KEY, private_key: FAKE_KEY, credentials: { x: 1 } })
    expect(lines[0]).not.toMatch(/FAKEFAKEFAKE/)
    expect(JSON.parse(lines[0])).toMatchObject({ privateKey: '[REDACTED]', private_key: '[REDACTED]', credentials: '[REDACTED]' })
  })
})
