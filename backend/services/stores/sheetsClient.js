// The ONLY file that talks to Google. It wraps the official @googleapis/sheets
// library in a few small functions and translates Google's many error shapes
// into one StorageError with a clear "kind" and a safe, readable message.
//
// Google concepts:
//   spreadsheet = the whole file (identified by its ID in the URL)
//   tab / sheet = one tab at the bottom (Leads, Activity, WorkflowRuns)
//   range       = which cells, e.g. "'Leads'" (whole tab) or "'Leads'!1:1" (first row)
import { auth, sheets } from '@googleapis/sheets'

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] // read + write spreadsheets, nothing else

/**
 * A storage failure.
 * kind:      what went wrong (see describeGoogleError). Decides what the logs say.
 * temporary: true if trying again later might work (e.g. Google slow or rate-limited);
 *            false for setup problems (wrong ID, sheet not shared), which need a human.
 * googleStatus / googleCode: the HTTP status and error code Google sent, for the logs.
 *
 * SECURITY: the original Google error is deliberately NOT kept. It contains the request
 * configuration, including the "Authorization: Bearer ..." access token, which must never
 * end up in a log.
 */
export class StorageError extends Error {
  constructor(kind, message, { temporary = false, googleStatus = null, googleCode = null } = {}) {
    super(message)
    this.name = 'StorageError'
    this.kind = kind
    this.temporary = temporary
    this.googleStatus = googleStatus
    this.googleCode = googleCode
  }
}

/** Turns any error from Google (or the network) into a StorageError. */
export function describeGoogleError(err) {
  if (err instanceof StorageError) return err
  const status = err?.status ?? err?.response?.status ?? (typeof err?.code === 'number' ? err.code : undefined)
  const code = typeof err?.code === 'string' ? err.code : ''
  const text = `${err?.message ?? ''} ${JSON.stringify(err?.response?.data ?? '')}`

  const make = (kind, message, temporary = false) =>
    new StorageError(kind, message, { temporary, googleStatus: status ?? null, googleCode: code || null })

  if (code.startsWith('ERR_OSSL') || /invalid_grant|invalid_client|Invalid JWT|unauthorized_client/i.test(text) || status === 401) {
    return make('auth', 'Google rejected the service account credentials. Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.')
  }
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) {
    return make('api_disabled', 'The Google Sheets API is not enabled for this Google Cloud project.')
  }
  if (status === 403) {
    return make('permission', 'The service account has no access to this spreadsheet. Share the sheet with the service account email as Editor.')
  }
  if (status === 404) {
    return make('not_found', 'Spreadsheet not found. Check GOOGLE_SHEETS_SPREADSHEET_ID.')
  }
  if (status === 400 && /Unable to parse range/i.test(text)) {
    return make('missing_tab', 'A required tab is missing from the spreadsheet. If a tab was renamed, rename it back. Otherwise run "npm run sheets:setup".')
  }
  if (status === 429) {
    return make('rate_limited', 'Google Sheets rate limit reached. Try again in a minute.', true)
  }
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || /timeout|timed out/i.test(text)) {
    return make('timeout', 'Google Sheets did not respond in time.', true)
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH'].includes(code) || (status >= 500 && status < 600)) {
    return make('unavailable', 'Google Sheets is temporarily unreachable.', true)
  }
  return make('unknown', 'Unexpected error from Google Sheets.')
}

const quote = (tab) => `'${tab.replace(/'/g, "''")}'` // tab names are quoted in ranges

/**
 * Creates the client.
 * Pass { spreadsheetId, clientEmail, privateKey } for real use. Tests pass `api`
 * (a fake of the Google library) instead of credentials.
 */
export function createSheetsClient({ spreadsheetId, clientEmail, privateKey, timeoutMs = 10_000, api }) {
  const google =
    api ??
    sheets({ version: 'v4', auth: new auth.JWT({ email: clientEmail, key: privateKey, scopes: SCOPES }) })
  const options = { timeout: timeoutMs } // per-request timeout (only covers the Sheets request itself)

  /**
   * Runs one Google call with OUR OWN deadline and converts any failure into a StorageError.
   *
   * Why our own deadline? A Google call has two parts: getting a login token (oauth2)
   * and then the Sheets request. The library's `timeout` option only covers the second
   * part, so a hang while getting the token could block forever. This was found in a
   * failure drill: with an unresponsive network the API did not answer for 30+ seconds.
   * Promise.race returns whichever finishes first, the call or our timer.
   */
  async function run(call) {
    let timer
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new StorageError('timeout', 'Google Sheets did not respond in time.', { temporary: true })),
        timeoutMs,
      )
    })
    try {
      return await Promise.race([call(), deadline])
    } catch (err) {
      throw describeGoogleError(err)
    } finally {
      clearTimeout(timer) // stop the timer when the call finishes first
    }
  }

  return {
    spreadsheetId,

    /** All cells of a tab, as rows. Numbers come back as numbers (UNFORMATTED_VALUE). */
    async readTab(tab) {
      const res = await run(() =>
        google.spreadsheets.values.get({ spreadsheetId, range: quote(tab), valueRenderOption: 'UNFORMATTED_VALUE' }, options),
      )
      return res.data.values ?? []
    },

    /** Only the first row of a tab (its header). */
    async readHeaderRow(tab) {
      const res = await run(() =>
        google.spreadsheets.values.get({ spreadsheetId, range: `${quote(tab)}!1:1`, valueRenderOption: 'UNFORMATTED_VALUE' }, options),
      )
      return res.data.values?.[0] ?? []
    },

    /**
     * Adds one row at the bottom of a tab.
     * valueInputOption RAW: values are stored EXACTLY as sent. Text like
     * "=HYPERLINK(...)" stays text and never becomes a formula (prevents formula injection).
     */
    async appendRow(tab, row) {
      await run(() =>
        google.spreadsheets.values.append(
          {
            spreadsheetId,
            range: quote(tab),
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [row] },
          },
          options,
        ),
      )
    },

    /** Spreadsheet title and the names of its tabs. */
    async getInfo() {
      const res = await run(() =>
        google.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties.title' }, options),
      )
      return {
        title: res.data.properties?.title ?? '',
        tabs: (res.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean),
      }
    },

    /** Creates tabs (used only by the setup script). */
    async addTabs(names) {
      if (names.length === 0) return
      await run(() =>
        google.spreadsheets.batchUpdate(
          { spreadsheetId, requestBody: { requests: names.map((title) => ({ addSheet: { properties: { title } } })) } },
          options,
        ),
      )
    },

    /** Writes rows starting at A1 of a tab (used only by the setup script). */
    async writeRows(tab, rows) {
      await run(() =>
        google.spreadsheets.values.update(
          { spreadsheetId, range: `${quote(tab)}!A1`, valueInputOption: 'RAW', requestBody: { values: rows } },
          options,
        ),
      )
    },
  }
}
