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
    },
  },
  activity: {
    sheet: 'Activity',
    columns: { id: 'string', type: 'string', message: 'string', leadId: 'string?', timestamp: 'string' },
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

/** Object → row (array of cells) in the table's column order. */
export function toRow(table, record) {
  const { columns } = TABLES[table]
  return Object.entries(columns).map(([column, type]) => toCell(record[column], type, column))
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
 * Returns { records, skipped: [{ row, reason }] }, where "row" is the spreadsheet row number.
 */
export function parseSheet(table, values = []) {
  if (values.length === 0) {
    throw new SheetFormatError(`Sheet "${TABLES[table].sheet}" has no header row`)
  }
  const [headerRow, ...rows] = values
  const positions = readHeader(table, headerRow)

  const records = []
  const skipped = []
  rows.forEach((row, index) => {
    const rowNumber = index + 2 // +1 for the header, +1 because spreadsheet rows start at 1
    if (!row || row.every(isEmpty)) return // completely empty rows are simply ignored
    try {
      records.push(fromRow(table, positions, row))
    } catch (err) {
      if (!(err instanceof SheetFormatError)) throw err
      skipped.push({ row: rowNumber, reason: err.message })
    }
  })
  return { records, skipped }
}
