// Tests the Google wrapper with a FAKE Google library (no network):
// does it send the right options, and does it translate Google's errors correctly?
import { describe, expect, it, vi } from 'vitest'
import { StorageError, createSheetsClient, describeGoogleError } from '../services/stores/sheetsClient.js'

/** A fake of the @googleapis/sheets library: records every call and returns what we choose. */
function fakeGoogleApi({ values = [], fail } = {}) {
  const respond = vi.fn(async () => {
    if (fail) throw fail
    return { data: { values } }
  })
  return {
    respond,
    spreadsheets: {
      values: { get: respond, append: respond, update: respond },
      get: vi.fn(async () => ({ data: { properties: { title: 'LeadPilot' }, sheets: [{ properties: { title: 'Leads' } }] } })),
      batchUpdate: respond,
    },
  }
}

const ID = 'spreadsheet-id-1234567890'

describe('sheetsClient requests', () => {
  it('reads a whole tab with UNFORMATTED_VALUE (numbers stay numbers) and a timeout', async () => {
    const api = fakeGoogleApi({ values: [['id'], ['LD-1']] })
    const client = createSheetsClient({ spreadsheetId: ID, timeoutMs: 1234, api })

    expect(await client.readTab('Leads')).toEqual([['id'], ['LD-1']])
    expect(api.respond).toHaveBeenCalledWith(
      { spreadsheetId: ID, range: "'Leads'", valueRenderOption: 'UNFORMATTED_VALUE' },
      { timeout: 1234 },
    )
  })

  it('returns [] for an empty tab (Google sends no "values" at all)', async () => {
    const api = fakeGoogleApi({ values: undefined })
    expect(await createSheetsClient({ spreadsheetId: ID, api }).readTab('Leads')).toEqual([])
  })

  it('reads only the first row for the header', async () => {
    const api = fakeGoogleApi({ values: [['id', 'name']] })
    expect(await createSheetsClient({ spreadsheetId: ID, api }).readHeaderRow('Leads')).toEqual(['id', 'name'])
    expect(api.respond.mock.calls[0][0].range).toBe("'Leads'!1:1")
  })

  it('appends with valueInputOption RAW, so formulas are stored as plain text', async () => {
    const api = fakeGoogleApi()
    await createSheetsClient({ spreadsheetId: ID, api }).appendRow('Leads', ['LD-1', '=SUM(1,1)'])
    expect(api.respond.mock.calls[0][0]).toEqual({
      spreadsheetId: ID,
      range: "'Leads'",
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [['LD-1', '=SUM(1,1)']] },
    })
  })

  it('quotes tab names safely', async () => {
    const api = fakeGoogleApi()
    await createSheetsClient({ spreadsheetId: ID, api }).readTab("Bob's Leads")
    expect(api.respond.mock.calls[0][0].range).toBe("'Bob''s Leads'")
  })

  it('getInfo returns the title and tab names', async () => {
    const api = fakeGoogleApi()
    expect(await createSheetsClient({ spreadsheetId: ID, api }).getInfo()).toEqual({ title: 'LeadPilot', tabs: ['Leads'] })
  })

  it('gives up with a "timeout" StorageError when Google never answers (found in a failure drill)', async () => {
    const neverAnswers = { spreadsheets: { values: { get: () => new Promise(() => {}) } } } // a promise that never settles
    const client = createSheetsClient({ spreadsheetId: ID, timeoutMs: 50, api: neverAnswers })

    const started = Date.now()
    const error = await client.readTab('Leads').catch((e) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(error).toMatchObject({ kind: 'timeout', temporary: true })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('a call that finishes in time is not affected by the deadline', async () => {
    const api = fakeGoogleApi({ values: [['id']] })
    const client = createSheetsClient({ spreadsheetId: ID, timeoutMs: 50, api })
    expect(await client.readTab('Leads')).toEqual([['id']])
    await new Promise((resolve) => setTimeout(resolve, 80)) // the old timer must not fire later
  })

  it('turns a Google failure into a StorageError', async () => {
    const api = fakeGoogleApi({ fail: Object.assign(new Error('Requested entity was not found.'), { status: 404 }) })
    const error = await createSheetsClient({ spreadsheetId: ID, api }).readTab('Leads').catch((e) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(error.kind).toBe('not_found')
  })
})

describe('with the REAL Google library (no network needed)', () => {
  it('a broken private key fails locally and becomes an "auth" StorageError', async () => {
    // Signing the login token fails on this machine before anything is sent to Google.
    const client = createSheetsClient({
      spreadsheetId: ID,
      clientEmail: 'test@test-project.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nNOT-A-REAL-KEY\n-----END PRIVATE KEY-----\n',
      timeoutMs: 5000,
    })
    const error = await client.readTab('Leads').catch((e) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(error.kind).toBe('auth')
    expect(error.message).toMatch(/GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY/)
  })
})

describe('describeGoogleError', () => {
  const googleError = (props, message = 'Google error') => Object.assign(new Error(message), props)

  it.each([
    ['bad private key (local signing error)', googleError({ code: 'ERR_OSSL_UNSUPPORTED' }, 'error:1E08010C:DECODER routines::unsupported'), 'auth', false],
    ['invalid_grant (wrong email/key pair)', googleError({}, 'invalid_grant: Invalid JWT Signature.'), 'auth', false],
    ['401', googleError({ status: 401 }), 'auth', false],
    ['API not enabled', googleError({ status: 403 }, 'Google Sheets API has not been used in project 123 before or it is disabled.'), 'api_disabled', false],
    ['403 not shared', googleError({ status: 403 }, 'The caller does not have permission'), 'permission', false],
    ['404 wrong ID', googleError({ status: 404 }), 'not_found', false],
    ['400 missing tab', googleError({ status: 400 }, 'Unable to parse range: Leads'), 'missing_tab', false],
    ['429 rate limit', googleError({ status: 429 }, 'Quota exceeded'), 'rate_limited', true],
    ['timeout', googleError({ code: 'ETIMEDOUT' }), 'timeout', true],
    ['aborted request', googleError({ name: 'AbortError' }, 'The operation was aborted'), 'timeout', true],
    ['no internet', googleError({ code: 'ENOTFOUND' }), 'unavailable', true],
    ['Google 503', googleError({ status: 503 }), 'unavailable', true],
    ['something else', new Error('weird'), 'unknown', false],
  ])('%s → %s (temporary: %s)', (_label, err, kind, temporary) => {
    const result = describeGoogleError(err)
    expect(result).toBeInstanceOf(StorageError)
    expect(result.kind).toBe(kind)
    expect(result.temporary).toBe(temporary)
  })

  it('reads the HTTP status from err.response.status too', () => {
    expect(describeGoogleError(googleError({ response: { status: 404 } })).kind).toBe('not_found')
  })

  it('never keeps the original error, which can contain the access token', () => {
    const err = googleError({
      status: 403,
      config: { headers: { Authorization: 'Bearer ya29.SECRET-ACCESS-TOKEN' } },
      response: { status: 403, config: { headers: { Authorization: 'Bearer ya29.SECRET-ACCESS-TOKEN' } } },
    })
    const result = describeGoogleError(err)
    expect(result.cause).toBeUndefined()
    expect(JSON.stringify({ ...result, message: result.message })).not.toMatch(/SECRET-ACCESS-TOKEN/)
    expect(result).toMatchObject({ kind: 'permission', googleStatus: 403 })
  })
})
