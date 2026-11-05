// A fake sheetsClient for tests: an in-memory "spreadsheet" with no network.
// It copies the Google behaviours that matter to our code:
// - values are stored exactly as sent (like valueInputOption RAW)
// - when reading, empty cells at the END of a row are left out (Google does this)
// - reading a tab that doesn't exist fails with a missing_tab StorageError
// It also counts calls (to test the cache) and can be told to fail.
import { StorageError } from '../services/stores/sheetsClient.js'
import { TABLES, headerFor, toRow } from '../services/stores/sheetsMapper.js'

const isBlank = (cell) => cell === '' || cell === null || cell === undefined

/** Removes empty cells at the end of a row, as Google does when returning values. */
function trimRow(row) {
  const copy = [...row]
  while (copy.length > 0 && isBlank(copy[copy.length - 1])) copy.pop()
  return copy
}

/**
 * tabs: { TabName: [[header...], [row...], ...] }
 * Use fakeSpreadsheetFromSeed() to build tabs from objects.
 */
export function createFakeSheetsClient(tabs = {}) {
  const sheets = structuredClone(tabs)
  const calls = { readTab: 0, readHeaderRow: 0, appendRow: 0 }
  let failure = null // { kind, temporary, times }

  function maybeFail() {
    if (!failure) return
    failure.times -= 1
    const { kind, temporary } = failure
    if (failure.times <= 0) failure = null
    throw new StorageError(kind, `Simulated ${kind} failure`, { temporary })
  }

  function tab(name) {
    if (!(name in sheets)) throw new StorageError('missing_tab', `Simulated: tab "${name}" is missing`)
    return sheets[name]
  }

  return {
    calls,
    sheets, // tests can look at, or edit, the raw cells (like editing the sheet by hand)

    /** Make the next `times` calls fail with this kind of error. */
    failNext(kind, { temporary = false, times = 1 } = {}) {
      failure = { kind, temporary, times }
    },

    async readTab(name) {
      calls.readTab++
      maybeFail()
      return structuredClone(tab(name).map(trimRow))
    },
    async readHeaderRow(name) {
      calls.readHeaderRow++
      maybeFail()
      return structuredClone(trimRow(tab(name)[0] ?? []))
    },
    async appendRow(name, row) {
      calls.appendRow++
      maybeFail()
      tab(name).push(structuredClone(row))
    },
    async getInfo() {
      maybeFail()
      return { title: 'Fake LeadPilot Data', tabs: Object.keys(sheets) }
    },
    async addTabs(names) {
      maybeFail()
      for (const name of names) {
        if (name in sheets) throw new StorageError('unknown', `Simulated: tab "${name}" already exists`)
        sheets[name] = []
      }
    },
    /** Like Google's values.update at A1: overwrites the first rows.length rows. */
    async writeRows(name, rows) {
      maybeFail()
      const target = tab(name)
      rows.forEach((row, i) => (target[i] = structuredClone(row)))
    },
  }
}

/** Builds fake spreadsheet tabs (header + rows) from seed objects { leads, activity, workflowRuns }. */
export function fakeSpreadsheetFromSeed(seed) {
  const tabs = {}
  for (const table of Object.keys(TABLES)) {
    tabs[TABLES[table].sheet] = [headerFor(table), ...(seed[table] ?? []).map((record) => toRow(table, record))]
  }
  return tabs
}
