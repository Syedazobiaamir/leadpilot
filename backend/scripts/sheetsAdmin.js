// Setup and diagnostics for the Google Sheets store.
// Used by scripts/sheets.js (npm run sheets:check / sheets:setup).
// The functions take a client and a print function, so tests can run them against a
// fake spreadsheet and read what they would print.
//
// SAFETY RULES (setup):
// - It never deletes or overwrites data.
// - A tab with a WRONG header is reported, not "fixed", because it may contain real data.
// - Sample data is only added to a tab that has a header and no rows.
import { TABLES, headerFor, parseSheet, readHeader, toRow } from '../services/stores/sheetsMapper.js'
import { StorageError } from '../services/stores/sheetsClient.js'
import { sampleLeads } from '../data/sampleLeads.js'
import { sampleActivity } from '../data/sampleActivity.js'
import { sampleWorkflowRuns } from '../data/sampleWorkflowRuns.js'

const SAMPLE = { leads: sampleLeads, activity: sampleActivity, workflowRuns: sampleWorkflowRuns }

/** What to do for each kind of storage error (shown to the person running the script). */
export const FIX_HINTS = {
  auth: 'Copy client_email and private_key again from the JSON key file into .env. If the key was deleted in Google Cloud, create a new one.',
  api_disabled: 'In Google Cloud Console: APIs & Services → Library → "Google Sheets API" → Enable. Wait a minute, then try again.',
  permission: 'Open the spreadsheet → Share → add the service account email (shown above) as Editor.',
  not_found: 'Copy the ID again from the spreadsheet URL: the part between /d/ and /edit.',
  missing_tab: 'If you renamed the tab, rename it back (exact name, same capital letters). If it was never created, run: npm run sheets:setup',
  rate_limited: 'Google limits requests per minute. Wait one minute and try again.',
  timeout: 'Check your internet connection and try again.',
  unavailable: 'Check your internet connection. If it works, Google may be having problems. Try again later.',
  unknown: 'Unexpected error. Check the settings in .env and try again.',
}

/** Our columns that are missing from a header row. */
function missingColumns(table, headerRow = []) {
  const names = new Set(headerRow.map((h) => String(h ?? '').trim()))
  return headerFor(table).filter((column) => !names.has(column))
}

/**
 * True if the only missing columns are ones added in a later stage (TABLES[table].addedLater).
 * Then the tab is clearly OUR tab from an older version, and adding the columns is safe.
 */
function onlyNewColumnsMissing(table, headerRow) {
  const missing = missingColumns(table, headerRow)
  const addable = TABLES[table].addedLater ?? []
  return missing.length > 0 && missing.every((column) => addable.includes(column))
}

function failureLine(err) {
  if (err instanceof StorageError) {
    return { reason: err.message, fix: FIX_HINTS[err.kind] ?? FIX_HINTS.unknown }
  }
  return { reason: err.message, fix: null }
}

/**
 * Checks everything step by step and explains what's wrong. Reads only, never writes.
 * Returns true if everything is OK.
 */
export async function checkSheets({ client, serviceAccountEmail, print = console.log }) {
  let ok = true
  const pass = (msg) => print(`PASS  ${msg}`)
  const fail = (msg, err) => {
    ok = false
    print(`FAIL  ${msg}`)
    if (err) {
      const { reason, fix } = failureLine(err)
      print(`      Reason: ${reason}`)
      if (fix) print(`      Fix:    ${fix}`)
    }
  }

  print(`Service account: ${serviceAccountEmail ?? '(unknown)'}`)
  print(`Spreadsheet ID:  ${client.spreadsheetId ?? '(unknown)'}\n`)

  // 1. Can we sign in AND open the spreadsheet? (one request tests both)
  let info
  try {
    info = await client.getInfo()
    pass(`Signed in and opened spreadsheet "${info.title}"`)
  } catch (err) {
    fail('Could not open the spreadsheet', err)
    return false // nothing else can work without this
  }

  // 2. Each tab: present, correct header, readable rows
  for (const table of Object.keys(TABLES)) {
    const { sheet } = TABLES[table]
    if (!info.tabs.includes(sheet)) {
      fail(`Tab "${sheet}" is missing`, new StorageError('missing_tab', `The spreadsheet has no tab named "${sheet}".`))
      continue
    }
    try {
      const values = await client.readTab(sheet)
      if (values.length === 0) {
        fail(`Tab "${sheet}" is empty (no header row)`, new StorageError('missing_tab', `Tab "${sheet}" has no header row.`))
        continue
      }
      const { records, skipped } = parseSheet(table, values)
      pass(`Tab "${sheet}": header OK, ${records.length} row(s)`)
      for (const problem of skipped) {
        // A warning, not a failure: the app skips these rows and keeps working.
        print(`WARN  Tab "${sheet}" row ${problem.row} will be ignored: ${problem.reason}`)
      }
    } catch (err) {
      fail(`Tab "${sheet}" cannot be used`, err)
      if (err instanceof StorageError) continue
      const header = (await client.readHeaderRow(sheet).catch(() => [])) ?? []
      if (onlyNewColumnsMissing(table, header)) {
        print(`      Fix:    This tab is from an older version. Run: npm run sheets:setup (adds the new columns, keeps all data)`)
      } else {
        print(`      Fix:    Make row 1 of "${sheet}" exactly: ${headerFor(table).join(', ')}`)
      }
    }
  }

  print(ok ? '\nAll checks passed. Google Sheets is ready.' : '\nSome checks failed. Fix the items above and run this again.')
  return ok
}

/**
 * Creates missing tabs and header rows. With seed: true, also adds the SIMULATED
 * sample data to tabs that are still empty. Never deletes or overwrites anything.
 * Returns true if every tab ended up usable.
 */
export async function setupSheets({ client, seed = false, print = console.log }) {
  const info = await client.getInfo() // fails early with a clear StorageError if access is broken
  print(`Spreadsheet "${info.title}"\n`)

  const tables = Object.keys(TABLES)
  const missing = tables.map((t) => TABLES[t].sheet).filter((sheet) => !info.tabs.includes(sheet))
  if (missing.length > 0) {
    await client.addTabs(missing)
    print(`Created tab(s): ${missing.join(', ')}`)
  }

  let ok = true
  for (const table of tables) {
    const { sheet } = TABLES[table]
    const values = await client.readTab(sheet)
    const header = headerFor(table)

    if (values.length === 0) {
      // Empty tab: write the header, plus the sample data if asked
      const rows = seed ? SAMPLE[table].map((record) => toRow(table, record)) : []
      await client.writeRows(sheet, [header, ...rows])
      print(`${sheet}: header written${seed ? `, ${rows.length} SIMULATED sample row(s) added` : ''}`)
      continue
    }

    try {
      readHeader(table, values[0])
    } catch (err) {
      if (onlyNewColumnsMissing(table, values[0])) {
        // MIGRATION: our tab from an older version. Add the new column names to the
        // header, to the RIGHT of every used column (also right of any data under an
        // unnamed column), so no existing cell is overwritten. Data rows are not touched:
        // their new cells start empty, and leadService fills in defaults when reading.
        const width = Math.max(...values.map((row) => row.length))
        const newColumns = missingColumns(table, values[0])
        const headerRow = [...values[0]]
        while (headerRow.length < width) headerRow.push('')
        await client.updateRow(sheet, 1, [...headerRow, ...newColumns])
        print(`${sheet}: added new column(s) at the end: ${newColumns.join(', ')} (existing data not changed)`)
        continue
      }
      // Wrong header on a tab that has content: could be real data, so don't touch it.
      ok = false
      print(`${sheet}: NOT CHANGED. ${err.message}`)
      print(`  Fix by hand: row 1 must contain these columns: ${header.join(', ')}`)
      continue
    }

    const dataRows = values.length - 1
    if (seed && dataRows === 0) {
      // The tab holds only the header, so write header + all rows in ONE request
      // (Google limits writes per minute). Row 1 gets our standard header.
      const rows = SAMPLE[table].map((record) => toRow(table, record))
      await client.writeRows(sheet, [header, ...rows])
      print(`${sheet}: header OK, ${rows.length} SIMULATED sample row(s) added`)
    } else if (seed) {
      print(`${sheet}: header OK, already has ${dataRows} row(s), sample data NOT added (it never adds to existing data)`)
    } else {
      print(`${sheet}: header OK (${dataRows} row(s)), nothing to do`)
    }
  }

  print(ok ? '\nSetup complete. Run "npm run sheets:check" to confirm.' : '\nSetup finished with problems. See above.')
  return ok
}
