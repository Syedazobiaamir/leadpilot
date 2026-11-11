// Converts between spreadsheet rows (arrays of cells) and JavaScript objects.
// Pure functions: no network, no Google. The Sheets store (sheetsStore.js) uses this.
//
// Why this exists: a spreadsheet has no types. Cells can be empty, numbers can come
// back as text, and people can edit the sheet by hand. This file turns that mess into
// clean objects, or reports exactly which row is broken and why.

// Column types:
//   'string'     text, required (must not be empty)
//   'string?'    text or null (an empty cell means null)
//   'number?'    a number or null
//   'integer'    a whole number, required
export const TABLES = {
  leads: {
    sheet: 'Leads',
    columns: {
      id: 'string', name: 'string', phone: 'string', email: 'string', zip: 'string',
      serviceType: 'string', timeline: 'string', message: 'string', source: 'string',
      classification: 'string?', score: 'number?', status: 'string', createdAt: 'string',
      // Added in Stage 4 (AI qualification). Optional, because rows created before Stage 4 have
      // these cells empty. leadService fills sensible defaults when reading them.
      qualificationStatus: 'string?', aiReason: 'string?', aiModel: 'string?', qualifiedAt: 'string?',
      // Added in Stage 5: Validation Agent flag codes, comma-separated (e.g. "too_vague,all_caps").
      reviewFlags: 'string?',
      // Added in Stage 7: the Idempotency-Key of the request that created the lead (never shown by the API).
      submissionKey: 'string?',
    },
    // Columns added after the tab was first created. `npm run sheets:setup` may add these
    // to an existing tab (at the end of the header row) without touching any data.
    addedLater: ['qualificationStatus', 'aiReason', 'aiModel', 'qualifiedAt', 'reviewFlags', 'submissionKey'],
  },
  activity: {
    sheet: 'Activity',
    columns: { id: 'string', type: 'string', message: 'string', leadId: 'string?', timestamp: 'string' },
  },
  followUps: {
    // Follow-up message DRAFTS written by the Follow-up Agent (Stage 5). This app never sends
    // anything itself: n8n sends "approved" drafts and then reports back (Stage 6 → "sent").
    sheet: 'FollowUps',
    columns: {
      id: 'string', leadId: 'string', channel: 'string', subject: 'string', body: 'string',
      status: 'string', aiModel: 'string', createdAt: 'string', decidedAt: 'string?', editedAt: 'string?',
      // Added in Stage 6: when n8n reported it sent, and how ("simulated" = no real message left).
      sentAt: 'string?', sentVia: 'string?',
      // Added in Stage 7: when n8n claimed it for sending ("sending"), and which n8n run did.
      claimedAt: 'string?', claimedBy: 'string?',
    },
    addedLater: ['sentAt', 'sentVia', 'claimedAt', 'claimedBy'],
  },
  agentRuns: {
    // One row per agent run (Stage 5): the audit trail of what each agent did.
    sheet: 'AgentRuns',
    columns: {
      runId: 'string', leadId: 'string?', agent: 'string', status: 'string',
      durationMs: 'integer', errorKind: 'string?', detail: 'string?', startedAt: 'string',
    },
  },
  recoveries: {
    // Stage 7: one row per PROBLEM the system is trying to fix by itself (e.g. a failed AI
    // qualification): how many tries, when the next one is due, and how it ended.
    //   status: pending_retry → recovered | escalated (a person must look)
    sheet: 'Recoveries',
    columns: {
      id: 'string', kind: 'string', targetId: 'string', status: 'string', attempts: 'integer',
      nextRetryAt: 'string?', lastErrorKind: 'string?', lastError: 'string?', createdAt: 'string', updatedAt: 'string',
    },
  },
  workflowRuns: {
    sheet: 'WorkflowRuns',
    columns: {
      id: 'string', workflow: 'string', leadId: 'string?', status: 'string',
      attempts: 'integer', maxAttempts: 'integer', lastError: 'string?', startedAt: 'string',
    },
  },
}

/** A problem with the sheet's structure or with one row. */
export class SheetFormatError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SheetFormatError'
  }
}

/** The header row (column names in order) for a table, e.g. for creating the sheet. */
export function headerFor(table) {
  return Object.keys(TABLES[table].columns)
}

const isEmpty = (cell) => cell === undefined || cell === null || String(cell).trim() === ''

/** Turns one cell into a value of the given type. Throws SheetFormatError if impossible. */
function parseCell(cell, type, column) {
  const optional = type.endsWith('?')
  if (isEmpty(cell)) {
    if (optional) return null
    throw new SheetFormatError(`"${column}" is empty`)
  }
  const base = type.replace('?', '')
  if (base === 'string') {
    // String(): a hand-typed ZIP like 78701 can come back as the number 78701.
    return String(cell)
  }
  const number = typeof cell === 'number' ? cell : Number(String(cell).trim())
  if (!Number.isFinite(number)) throw new SheetFormatError(`"${column}" is not a number ("${cell}")`)
  if (base === 'integer' && !Number.isInteger(number)) {
    throw new SheetFormatError(`"${column}" must be a whole number ("${cell}")`)
  }
  return number
}

/** Turns one value into a cell to write. null becomes an empty cell. */
function toCell(value, type, column) {
  if (value === null || value === undefined) {
    if (type.endsWith('?')) return ''
    throw new SheetFormatError(`Cannot save: "${column}" is required`)
  }
  // Numbers stay numbers. Everything else is written as text.
  // (The store writes with valueInputOption RAW, so text starting with "=" stays text, not a formula.)
  return typeof value === 'number' ? value : String(value)
}

/**
 * Object → row in the table's STANDARD column order.
 * Only use this for a tab whose header is exactly headerFor(table), e.g. when the setup
 * script creates a tab. For existing tabs, use toRowAt with the tab's real positions.
 */
export function toRow(table, record) {
  const { columns } = TABLES[table]
  return Object.entries(columns).map(([column, type]) => toCell(record[column], type, column))
}

/**
 * Object → row, placing each value at the position its column has IN THIS SHEET.
 * positions: from readHeader() (column name → index).
 * baseRow:   the row's current cells (for an update). Cells of columns we don't know,
 *            e.g. someone's own "notes" column, are KEPT, never wiped.
 *
 * (Stage 3 bug fixed in Stage 4: writes used the standard order, so after someone
 * reordered the columns, values would have landed in the wrong columns.)
 */
export function toRowAt(table, record, positions, baseRow = []) {
  const row = [...baseRow]
  for (const [column, type] of Object.entries(TABLES[table].columns)) {
    row[positions[column]] = toCell(record[column], type, column)
  }
  // Fill gaps (positions we skipped) with empty cells. A sparse array would become "null" in JSON.
  for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = ''
  return row
}

/**
 * Checks that the header row contains every column the table needs.
 * Extra columns (e.g. a "notes" column someone added) are allowed and ignored.
 * Returns a map of column name → position.
 */
export function readHeader(table, headerRow = []) {
  const { sheet, columns } = TABLES[table]
  const positions = {}
  headerRow.forEach((name, index) => {
    const key = String(name ?? '').trim()
    if (key && !(key in positions)) positions[key] = index
  })
  const missing = Object.keys(columns).filter((column) => !(column in positions))
  if (missing.length > 0) {
    throw new SheetFormatError(`Sheet "${sheet}" is missing column(s): ${missing.join(', ')}`)
  }
  return positions
}

/** Row → object, using the header positions. Throws SheetFormatError for a bad row. */
export function fromRow(table, positions, row) {
  const record = {}
  for (const [column, type] of Object.entries(TABLES[table].columns)) {
    // Google leaves out empty cells at the END of a row, so row[i] may be undefined.
    record[column] = parseCell(row[positions[column]], type, column)
  }
  return record
}

/**
 * Converts everything Google returned for one tab (header row first) into objects.
 * A broken row doesn't break the whole list: it's skipped and reported, so the
 * caller can log a warning and the app keeps working.
 * Returns {
 *   records,                   the valid rows as objects
 *   rowNumbers,                rowNumbers[i] = spreadsheet row of records[i] (needed for updates)
 *   rawRows,                   rawRows[i] = the original cells of records[i] (to keep unknown columns on update)
 *   positions,                 column name → index, from the header
 *   skipped: [{ row, reason }] broken rows, by spreadsheet row number
 * }
 */
export function parseSheet(table, values = []) {
  if (values.length === 0) {
    throw new SheetFormatError(`Sheet "${TABLES[table].sheet}" has no header row`)
  }
  const [headerRow, ...rows] = values
  const positions = readHeader(table, headerRow)

  const records = []
  const rowNumbers = []
  const rawRows = []
  const skipped = []
  rows.forEach((row, index) => {
    const rowNumber = index + 2 // +1 for the header, +1 because spreadsheet rows start at 1
    if (!row || row.every(isEmpty)) return // completely empty rows are simply ignored
    try {
      records.push(fromRow(table, positions, row))
      rowNumbers.push(rowNumber)
      rawRows.push(row)
    } catch (err) {
      if (!(err instanceof SheetFormatError)) throw err
      skipped.push({ row: rowNumber, reason: err.message })
    }
  })
  return { records, rowNumbers, rawRows, positions, skipped }
}
