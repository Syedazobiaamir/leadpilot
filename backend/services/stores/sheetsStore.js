// Google Sheets store: the same functions as memoryStore.js, but data lives in a spreadsheet.
//
//   service ─► sheetsStore (cache + error handling) ─► sheetsMapper (rows ⇄ objects)
//                                                    └► sheetsClient (talks to Google)
//
// Behaviour the rest of the app can rely on:
// - Reads are cached for a short time (Google allows ~60 reads/minute). Writes clear the cache.
// - A row someone broke by hand is skipped and logged. It never takes down the whole list.
// - ANY storage failure becomes a 503 STORAGE_UNAVAILABLE for the client, while the log
//   gets the exact reason (kind). Never a crash, never a fake success.
import { TABLES, SheetFormatError, headerFor, parseSheet, readHeader, toRow } from './sheetsMapper.js'
import { StorageError } from './sheetsClient.js'
import { AppError } from '../../utils/AppError.js'
import { logger as defaultLogger } from '../../utils/logger.js'

/**
 * client:  a sheetsClient (or a fake in tests)
 * cacheMs: how long read results are reused (0 = no cache)
 * now:     a clock function. Tests pass a fake one to control time.
 */
export function createSheetsStore({ client, cacheMs = 10_000, logger = defaultLogger, now = Date.now }) {
  // cache[table] = { expiresAt, promise }. Storing the PROMISE means that two requests
  // arriving at the same moment share ONE Google read instead of making two.
  const cache = {}

  /** Converts storage problems into the error the client sees. Logs the real reason. */
  function toAppError(err, action, table) {
    if (err instanceof StorageError) {
      logger.error('storage error', {
        store: 'sheets', action, table, kind: err.kind, temporary: err.temporary,
        reason: err.message, googleStatus: err.googleStatus, googleCode: err.googleCode,
      })
    } else if (err instanceof SheetFormatError) {
      // e.g. a column was deleted or renamed in the sheet
      logger.error('storage error', { store: 'sheets', action, table, kind: 'bad_format', temporary: false, reason: err.message })
    } else {
      return err // a real bug: let the error handler report it as a 500
    }
    // The client gets a safe, honest message, without the internal details.
    return new AppError(503, 'STORAGE_UNAVAILABLE', 'Lead storage is temporarily unavailable. Please try again shortly.')
  }

  async function loadTable(table) {
    const values = await client.readTab(TABLES[table].sheet)
    const { records, skipped } = parseSheet(table, values)
    for (const problem of skipped) {
      // The reason never contains personal data: it only quotes values from number columns.
      logger.warn('skipped invalid sheet row', { store: 'sheets', table, row: problem.row, reason: problem.reason })
    }
    return records
  }

  /** All records of a table: from the cache if it's fresh, otherwise from Google. */
  async function read(table) {
    const entry = cache[table]
    if (entry && entry.expiresAt > now()) {
      return structuredClone(await entry.promise)
    }
    const promise = loadTable(table)
    cache[table] = { expiresAt: now() + cacheMs, promise }
    try {
      return structuredClone(await promise)
    } catch (err) {
      delete cache[table] // never cache a failure
      throw toAppError(err, 'read', table)
    }
  }

  async function append(table, record) {
    const row = toRow(table, record) // throws SheetFormatError only if our own code passes bad data (a bug)
    try {
      await client.appendRow(TABLES[table].sheet, row)
    } catch (err) {
      throw toAppError(err, 'write', table)
    } finally {
      // Clear the cache even if the write failed: Google may have saved the row anyway
      // (e.g. a timeout after the write succeeded), so the next read must check.
      delete cache[table]
    }
    return structuredClone(record)
  }

  return {
    name: 'sheets',

    listLeads: () => read('leads'),
    async findLeadById(id) {
      return (await read('leads')).find((lead) => lead.id === id) ?? null
    },
    insertLead: (lead) => append('leads', lead),
    listActivity: () => read('activity'),
    insertActivity: (event) => append('activity', event),
    listWorkflowRuns: () => read('workflowRuns'),

    /**
     * Readiness check: can we reach the spreadsheet, and does every tab have the
     * right header? Reads only the header rows (cheap). Uses no cache, on purpose.
     */
    async ping() {
      for (const table of Object.keys(TABLES)) {
        try {
          readHeader(table, await client.readHeaderRow(TABLES[table].sheet))
        } catch (err) {
          throw toAppError(err, 'ping', table)
        }
      }
      return true
    },
  }
}

/** The header row of every tab, e.g. for the setup script. */
export function allHeaders() {
  return Object.fromEntries(Object.keys(TABLES).map((table) => [TABLES[table].sheet, headerFor(table)]))
}
