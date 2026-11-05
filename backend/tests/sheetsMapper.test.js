import { describe, expect, it } from 'vitest'
import { TABLES, SheetFormatError, fromRow, headerFor, parseSheet, readHeader, toRow } from '../services/stores/sheetsMapper.js'
import { contractSeed } from './storeContract.js'

const lead = contractSeed.leads[0] // Ana Lopez, ZIP 02134, score 90
const unclassified = contractSeed.leads[1] // classification null, score null
const header = headerFor('leads')

describe('headerFor', () => {
  it('lists the columns in order', () => {
    expect(header[0]).toBe('id')
    expect(header).toEqual(Object.keys(TABLES.leads.columns))
    expect(headerFor('workflowRuns')).toContain('maxAttempts')
  })
})

describe('toRow', () => {
  it('writes values in column order, numbers as numbers and null as an empty cell', () => {
    const row = toRow('leads', unclassified)
    expect(row).toHaveLength(header.length)
    expect(row[header.indexOf('name')]).toBe('Ben Okafor')
    expect(row[header.indexOf('classification')]).toBe('')
    expect(row[header.indexOf('score')]).toBe('')
    expect(toRow('leads', lead)[header.indexOf('score')]).toBe(90)
  })

  it('keeps ZIP codes as text so leading zeros survive', () => {
    expect(toRow('leads', lead)[header.indexOf('zip')]).toBe('02134')
  })

  it('ignores fields that are not columns', () => {
    expect(toRow('leads', { ...lead, secretNote: 'x' })).not.toContain('x')
  })

  it('refuses to write a record missing a required field', () => {
    expect(() => toRow('leads', { ...lead, email: null })).toThrow(SheetFormatError)
  })
})

describe('round trip', () => {
  it.each(['leads', 'activity', 'workflowRuns'])('%s: toRow → fromRow gives back the same objects', (table) => {
    const positions = readHeader(table, headerFor(table))
    for (const record of contractSeed[table]) {
      expect(fromRow(table, positions, toRow(table, record))).toEqual(record)
    }
  })
})

describe('readHeader', () => {
  it('finds columns in any order and ignores extra columns', () => {
    const shuffled = ['notes', ...[...header].reverse()]
    const positions = readHeader('leads', shuffled)
    expect(positions.id).toBe(shuffled.indexOf('id'))
  })

  it('tolerates spaces around header names', () => {
    expect(() => readHeader('leads', header.map((h) => ` ${h} `))).not.toThrow()
  })

  it('names every missing column', () => {
    const withoutTwo = header.filter((h) => h !== 'email' && h !== 'score')
    expect(() => readHeader('leads', withoutTwo)).toThrow('Sheet "Leads" is missing column(s): email, score')
  })
})

describe('fromRow: what Google can actually send back', () => {
  const positions = readHeader('leads', header)

  it('handles a short row (Google drops empty cells at the end)', () => {
    // A sheet whose LAST two columns are the optional ones, e.g. after someone reordered columns.
    const reordered = [...header.filter((h) => h !== 'classification' && h !== 'score'), 'classification', 'score']
    const reorderedPositions = readHeader('leads', reordered)
    // Google returns the row WITHOUT the two empty cells at the end: it's 2 cells shorter.
    const shortRow = reordered.slice(0, -2).map((column) => unclassified[column])
    expect(shortRow).toHaveLength(reordered.length - 2)
    expect(fromRow('leads', reorderedPositions, shortRow)).toEqual(unclassified)
  })

  it('turns a number typed by hand into text for text columns (e.g. ZIP 78701)', () => {
    const row = toRow('leads', { ...lead, zip: '78701' })
    row[header.indexOf('zip')] = 78701
    expect(fromRow('leads', positions, row).zip).toBe('78701')
  })

  it('reads numbers that come back as text ("90")', () => {
    const row = toRow('leads', lead)
    row[header.indexOf('score')] = '90'
    expect(fromRow('leads', positions, row).score).toBe(90)
  })

  it('treats a cell with only spaces as empty', () => {
    const row = toRow('leads', lead)
    row[header.indexOf('classification')] = '   '
    expect(fromRow('leads', positions, row).classification).toBeNull()
  })

  it('rejects a score that is not a number', () => {
    const row = toRow('leads', lead)
    row[header.indexOf('score')] = 'high'
    expect(() => fromRow('leads', positions, row)).toThrow('"score" is not a number ("high")')
  })

  it('rejects a missing required value', () => {
    const row = toRow('leads', lead)
    row[header.indexOf('email')] = ''
    expect(() => fromRow('leads', positions, row)).toThrow('"email" is empty')
  })

  it('rejects a non-whole number in an integer column', () => {
    const runPositions = readHeader('workflowRuns', headerFor('workflowRuns'))
    const row = toRow('workflowRuns', contractSeed.workflowRuns[0])
    row[headerFor('workflowRuns').indexOf('attempts')] = 2.5
    expect(() => fromRow('workflowRuns', runPositions, row)).toThrow('must be a whole number')
  })

  it('keeps formula-looking text as plain text', () => {
    const row = toRow('leads', { ...lead, name: '=HYPERLINK("http://evil.example")' })
    expect(fromRow('leads', positions, row).name).toBe('=HYPERLINK("http://evil.example")')
  })
})

describe('parseSheet', () => {
  it('converts a whole tab, skips empty rows and reports broken rows by row number', () => {
    const broken = toRow('leads', lead)
    broken[header.indexOf('score')] = 'high'

    const values = [
      header, // row 1
      toRow('leads', lead), // row 2
      [], // row 3: empty
      ['', '  '], // row 4: only blanks
      broken, // row 5: bad score
      toRow('leads', unclassified), // row 6
    ]
    const { records, skipped } = parseSheet('leads', values)

    expect(records).toEqual([lead, unclassified])
    expect(skipped).toEqual([{ row: 5, reason: '"score" is not a number ("high")' }])
  })

  it('returns an empty list for a sheet with only a header', () => {
    expect(parseSheet('activity', [headerFor('activity')])).toEqual({ records: [], skipped: [] })
  })

  it('fails clearly when the tab has no header row at all', () => {
    expect(() => parseSheet('activity', [])).toThrow('Sheet "Activity" has no header row')
  })

  it('fails clearly when a required column is missing', () => {
    expect(() => parseSheet('leads', [['id', 'name']])).toThrow(/missing column\(s\): phone/)
  })
})
