import { beforeEach, describe, expect, it } from 'vitest'
import { createSheetsStore } from '../services/stores/sheetsStore.js'
import { createLogger } from '../utils/logger.js'
import { headerFor } from '../services/stores/sheetsMapper.js'
import { runStoreContract, contractSeed } from './storeContract.js'
import { createFakeSheetsClient, fakeSpreadsheetFromSeed } from './fakeSheetsClient.js'

// 1. The Sheets store must follow EXACTLY the same rules as the memory store.
//    The cache is ON here, so the "returns copies" rules also cover cached data.
runStoreContract('sheets (fake Google)', async (seed) =>
  createSheetsStore({
    client: createFakeSheetsClient(fakeSpreadsheetFromSeed(seed)),
    cacheMs: 10_000,
    logger: createLogger({ level: 'silent' }),
  }),
)

// 2. Sheets-specific behaviour.
function setup({ cacheMs = 10_000 } = {}) {
  const client = createFakeSheetsClient(fakeSpreadsheetFromSeed(structuredClone(contractSeed)))
  const lines = []
  const logger = createLogger({ level: 'debug', output: (line) => lines.push(JSON.parse(line)) })
  let time = 1_000_000
  const clock = { now: () => time, advance: (ms) => (time += ms) }
  const store = createSheetsStore({ client, cacheMs, logger, now: clock.now })
  return { client, store, lines, clock }
}

const newLead = { ...contractSeed.leads[0], id: 'LD-2100', email: 'new@example.com', phone: '5125550199' }

describe('sheets store: cache', () => {
  let t
  beforeEach(() => (t = setup()))

  it('reuses one Google read for repeated reads within the cache time', async () => {
    await t.store.listLeads()
    await t.store.listLeads()
    await t.store.findLeadById('LD-2001')
    expect(t.client.calls.readTab).toBe(1)
  })

  it('reads again after the cache time has passed', async () => {
    await t.store.listLeads()
    t.clock.advance(10_001)
    await t.store.listLeads()
    expect(t.client.calls.readTab).toBe(2)
  })

  it('shares one Google read between requests that arrive at the same moment', async () => {
    await Promise.all([t.store.listLeads(), t.store.listLeads(), t.store.listLeads()])
    expect(t.client.calls.readTab).toBe(1)
  })

  it('caches each tab separately', async () => {
    await t.store.listLeads()
    await t.store.listActivity()
    expect(t.client.calls.readTab).toBe(2)
  })

  it('a write clears the cache, so the new row is visible immediately', async () => {
    await t.store.listLeads()
    await t.store.insertLead(newLead)
    const leads = await t.store.listLeads()
    expect(leads.map((l) => l.id)).toContain('LD-2100')
    expect(t.client.calls.readTab).toBe(2)
  })

  it('shows hand edits once the cache expires', async () => {
    await t.store.listLeads()
    t.client.sheets.Leads.push(t.client.sheets.Leads[1].map((cell, i) => (i === 0 ? 'LD-2200' : cell)))
    expect(await t.store.findLeadById('LD-2200')).toBeNull() // still cached
    t.clock.advance(10_001)
    expect(await t.store.findLeadById('LD-2200')).not.toBeNull()
  })

  it('with cacheMs 0, every read goes to Google', async () => {
    t = setup({ cacheMs: 0 })
    await t.store.listLeads()
    await t.store.listLeads()
    expect(t.client.calls.readTab).toBe(2)
  })
})

describe('sheets store: failures become an honest 503', () => {
  let t
  beforeEach(() => (t = setup()))

  it.each([
    ['timeout', true],
    ['rate_limited', true],
    ['unavailable', true],
    ['permission', false],
    ['not_found', false],
    ['auth', false],
  ])('a %s error on read → 503 STORAGE_UNAVAILABLE, with the real reason only in the log', async (kind, temporary) => {
    t.client.failNext(kind, { temporary })
    const error = await t.store.listLeads().catch((e) => e)

    expect(error).toMatchObject({ statusCode: 503, code: 'STORAGE_UNAVAILABLE' })
    expect(error.message).not.toMatch(/Simulated|permission|auth|spreadsheet/i) // no internals for the client
    expect(t.lines).toContainEqual(
      expect.objectContaining({ level: 'error', msg: 'storage error', kind, temporary, action: 'read', table: 'leads' }),
    )
  })

  it('does not cache a failure: the next read tries Google again and can succeed', async () => {
    t.client.failNext('timeout', { temporary: true })
    await expect(t.store.listLeads()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(await t.store.listLeads()).toHaveLength(2)
  })

  it('a failed write → 503, nothing is reported as saved, and the cache is cleared', async () => {
    await t.store.listLeads() // fill the cache
    t.client.failNext('unavailable', { temporary: true })
    await expect(t.store.insertLead(newLead)).rejects.toMatchObject({ statusCode: 503, code: 'STORAGE_UNAVAILABLE' })

    await t.store.listLeads()
    expect(t.client.calls.readTab).toBe(2) // read again after the failed write
  })

  it('a deleted column → 503, logged as bad_format with the column name', async () => {
    const header = t.client.sheets.Leads[0]
    header[header.indexOf('email')] = 'e-mail' // someone renamed a column by hand
    await expect(t.store.listLeads()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(t.lines).toContainEqual(
      expect.objectContaining({ msg: 'storage error', kind: 'bad_format', reason: 'Sheet "Leads" is missing column(s): email' }),
    )
  })

  it('a missing tab → 503, logged as missing_tab', async () => {
    delete t.client.sheets.Activity
    await expect(t.store.listActivity()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(t.lines).toContainEqual(expect.objectContaining({ kind: 'missing_tab', table: 'activity' }))
  })
})

describe('sheets store: rows broken by hand', () => {
  it('skips the broken row, keeps the rest, and logs a warning without personal data', async () => {
    const t = setup()
    const header = headerFor('leads')
    t.client.sheets.Leads[1][header.indexOf('score')] = 'very hot' // row 2 broken by hand

    const leads = await t.store.listLeads()
    expect(leads.map((l) => l.id)).toEqual(['LD-2002'])

    const warning = t.lines.find((l) => l.msg === 'skipped invalid sheet row')
    expect(warning).toMatchObject({ level: 'warn', table: 'leads', row: 2, reason: '"score" is not a number ("very hot")' })
    expect(JSON.stringify(t.lines)).not.toMatch(/Ana Lopez|ana@example\.com|5125550101/)
  })
})

describe('sheets store: writes', () => {
  it('appends exactly one row with values in column order', async () => {
    const t = setup()
    await t.store.insertLead(newLead)
    const rows = t.client.sheets.Leads
    expect(t.client.calls.appendRow).toBe(1)
    expect(rows).toHaveLength(4) // header + 2 seed + 1 new
    expect(rows[3][0]).toBe('LD-2100')
  })
})

describe('sheets store: ping (readiness)', () => {
  it('passes when every tab has the right header, reading only header rows', async () => {
    const t = setup()
    expect(await t.store.ping()).toBe(true)
    expect(t.client.calls.readHeaderRow).toBe(3)
    expect(t.client.calls.readTab).toBe(0)
  })

  it('fails with 503 when a tab is missing', async () => {
    const t = setup()
    delete t.client.sheets.WorkflowRuns
    await expect(t.store.ping()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(t.lines).toContainEqual(expect.objectContaining({ action: 'ping', table: 'workflowRuns', kind: 'missing_tab' }))
  })

  it('fails with 503 when a header is wrong', async () => {
    const t = setup()
    t.client.sheets.Activity[0] = ['id', 'type']
    await expect(t.store.ping()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
  })

  it('is never served from the cache', async () => {
    const t = setup()
    await t.store.ping()
    await t.store.ping()
    expect(t.client.calls.readHeaderRow).toBe(6)
  })
})

describe('sheets store: writes respect the sheet\'s real column layout (Stage 3 bug, fixed in Stage 4)', () => {
  /** A Leads tab where someone REORDERED the columns and ADDED their own "notes" column. */
  function reorderedSetup() {
    const header = [...headerFor('leads')].reverse()
    header.splice(3, 0, 'notes') // a custom column in the middle
    const rowFor = (lead, note) => header.map((h) => (h === 'notes' ? note : lead[h] ?? ''))
    const tabs = fakeSpreadsheetFromSeed(structuredClone(contractSeed))
    tabs.Leads = [header, rowFor(contractSeed.leads[0], 'VIP customer'), rowFor(contractSeed.leads[1], 'call after 5pm')]
    const client = createFakeSheetsClient(tabs)
    const store = createSheetsStore({ client, cacheMs: 10_000, logger: createLogger({ level: 'silent' }) })
    const cell = (rowIndex, column) => client.sheets.Leads[rowIndex][header.indexOf(column)]
    return { client, store, cell }
  }

  it('reads correctly from reordered columns', async () => {
    const { store } = reorderedSetup()
    expect(await store.findLeadById('LD-2001')).toEqual(contractSeed.leads[0])
  })

  it('insert puts every value in its own column', async () => {
    const { store, cell } = reorderedSetup()
    await store.insertLead(newLead)
    expect(cell(3, 'id')).toBe('LD-2100')
    expect(cell(3, 'email')).toBe('new@example.com')
    expect(cell(3, 'phone')).toBe('5125550199')
    expect(cell(3, 'notes')).toBe('') // our insert leaves the custom column empty
    expect(await store.findLeadById('LD-2100')).toEqual(newLead)
  })

  it('update changes our columns and KEEPS the custom "notes" cell', async () => {
    const { store, cell } = reorderedSetup()
    await store.updateLead('LD-2002', { classification: 'Warm', score: 70 })
    expect(cell(2, 'classification')).toBe('Warm')
    expect(cell(2, 'score')).toBe(70)
    expect(cell(2, 'notes')).toBe('call after 5pm')
    expect(cell(1, 'notes')).toBe('VIP customer') // the other row is untouched
  })
})

describe('sheets store: updateLead safety', () => {
  it('finds the row with a FRESH read, never from a stale cache', async () => {
    const t = setup()
    await t.store.listLeads() // cache now holds the old layout
    // Someone deletes row 2 (LD-2001) by hand: LD-2002 moves up to row 2
    t.client.sheets.Leads.splice(1, 1)
    await t.store.updateLead('LD-2002', { score: 55 })

    expect(t.client.sheets.Leads).toHaveLength(2) // header + LD-2002 only
    expect(t.client.sheets.Leads[1][0]).toBe('LD-2002')
    t.clock.advance(10_001)
    expect((await t.store.findLeadById('LD-2002')).score).toBe(55)
  })

  it('clears the cache after an update', async () => {
    const t = setup()
    await t.store.listLeads()
    await t.store.updateLead('LD-2002', { score: 55 })
    expect((await t.store.findLeadById('LD-2002')).score).toBe(55) // no clock advance needed
  })

  it('a failed update → 503, logged as action "update"', async () => {
    const t = setup()
    t.client.failNext('timeout', { temporary: true })
    await expect(t.store.updateLead('LD-2002', { score: 55 })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(t.lines).toContainEqual(expect.objectContaining({ action: 'update', kind: 'timeout' }))
  })
})
