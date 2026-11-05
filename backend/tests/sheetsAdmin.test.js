// Tests the sheets:check and sheets:setup logic against a fake spreadsheet.
import { describe, expect, it } from 'vitest'
import { checkSheets, setupSheets } from '../scripts/sheetsAdmin.js'
import { headerFor } from '../services/stores/sheetsMapper.js'
import { createSheetsStore } from '../services/stores/sheetsStore.js'
import { createLogger } from '../utils/logger.js'
import { createFakeSheetsClient, fakeSpreadsheetFromSeed } from './fakeSheetsClient.js'
import { contractSeed } from './storeContract.js'

/** Runs a script function and collects what it prints. */
async function run(fn, options) {
  const lines = []
  const ok = await fn({ ...options, print: (line) => lines.push(line) })
  return { ok, output: lines.join('\n') }
}

describe('sheets:setup', () => {
  it('on a brand-new spreadsheet (only "Sheet1"): creates all tabs with headers', async () => {
    const client = createFakeSheetsClient({ Sheet1: [] })
    const { ok, output } = await run(setupSheets, { client })

    expect(ok).toBe(true)
    expect(client.sheets.Leads).toEqual([headerFor('leads')])
    expect(client.sheets.Activity).toEqual([headerFor('activity')])
    expect(client.sheets.WorkflowRuns).toEqual([headerFor('workflowRuns')])
    expect(client.sheets.Sheet1).toEqual([]) // untouched
    expect(output).toMatch(/Created tab\(s\): Leads, Activity, WorkflowRuns/)
  })

  it('with --seed: adds the SIMULATED sample data, which the store can then read', async () => {
    const client = createFakeSheetsClient({ Sheet1: [] })
    const { ok, output } = await run(setupSheets, { client, seed: true })

    expect(ok).toBe(true)
    expect(output).toMatch(/Leads: header written, 10 SIMULATED sample row\(s\) added/)
    const store = createSheetsStore({ client, cacheMs: 0, logger: createLogger({ level: 'silent' }) })
    expect(await store.listLeads()).toHaveLength(10)
    expect(await store.listActivity()).toHaveLength(8)
    expect(await store.listWorkflowRuns()).toHaveLength(8)
  })

  it('seeds a tab that has only a header row', async () => {
    const client = createFakeSheetsClient({ Leads: [headerFor('leads')], Activity: [headerFor('activity')], WorkflowRuns: [headerFor('workflowRuns')] })
    await run(setupSheets, { client, seed: true })
    expect(client.sheets.Leads).toHaveLength(11) // header + 10
  })

  it('NEVER adds sample data to a tab that already has rows, and never changes existing rows', async () => {
    const tabs = fakeSpreadsheetFromSeed(structuredClone(contractSeed))
    const before = structuredClone(tabs)
    const client = createFakeSheetsClient(tabs)

    const { ok, output } = await run(setupSheets, { client, seed: true })
    expect(ok).toBe(true)
    expect(client.sheets).toEqual(before)
    expect(output).toMatch(/Leads: header OK, already has 2 row\(s\), sample data NOT added/)
  })

  it('running it twice is safe (second run changes nothing)', async () => {
    const client = createFakeSheetsClient({ Sheet1: [] })
    await run(setupSheets, { client, seed: true })
    const afterFirst = structuredClone(client.sheets)
    await run(setupSheets, { client, seed: true })
    expect(client.sheets).toEqual(afterFirst)
  })

  it('does NOT touch a tab whose header is wrong (it may hold real data) and reports it', async () => {
    const tabs = fakeSpreadsheetFromSeed(structuredClone(contractSeed))
    tabs.Leads[0] = ['Name', 'Phone'] // someone's own layout
    const before = structuredClone(tabs.Leads)
    const client = createFakeSheetsClient(tabs)

    const { ok, output } = await run(setupSheets, { client, seed: true })
    expect(ok).toBe(false)
    expect(client.sheets.Leads).toEqual(before)
    expect(output).toMatch(/Leads: NOT CHANGED/)
    expect(output).toMatch(/row 1 must contain these columns: id, name, phone/)
  })

  it('fails early with a clear error when the spreadsheet cannot be opened', async () => {
    const client = createFakeSheetsClient({})
    client.failNext('permission')
    await expect(run(setupSheets, { client })).rejects.toMatchObject({ kind: 'permission' })
  })
})

describe('sheets:check', () => {
  it('passes on a correctly set-up spreadsheet and reports row counts', async () => {
    const client = createFakeSheetsClient(fakeSpreadsheetFromSeed(structuredClone(contractSeed)))
    const { ok, output } = await run(checkSheets, { client, serviceAccountEmail: 'bot@p.iam.gserviceaccount.com' })

    expect(ok).toBe(true)
    expect(output).toMatch(/Service account: bot@p\.iam\.gserviceaccount\.com/)
    expect(output).toMatch(/PASS  Tab "Leads": header OK, 2 row\(s\)/)
    expect(output).toMatch(/All checks passed/)
  })

  it.each([
    ['permission', /Share → add the service account email/],
    ['not_found', /between \/d\/ and \/edit/],
    ['auth', /Copy client_email and private_key again/],
    ['api_disabled', /Enable/],
  ])('explains how to fix a %s error', async (kind, fixText) => {
    const client = createFakeSheetsClient({})
    client.failNext(kind)
    const { ok, output } = await run(checkSheets, { client })
    expect(ok).toBe(false)
    expect(output).toMatch(/FAIL  Could not open the spreadsheet/)
    expect(output).toMatch(fixText)
  })

  it('reports missing tabs and suggests sheets:setup', async () => {
    const client = createFakeSheetsClient({ Sheet1: [] })
    const { ok, output } = await run(checkSheets, { client })
    expect(ok).toBe(false)
    expect(output).toMatch(/FAIL  Tab "Leads" is missing/)
    expect(output).toMatch(/npm run sheets:setup/)
  })

  it('reports a wrong header with the exact columns needed', async () => {
    const tabs = fakeSpreadsheetFromSeed(structuredClone(contractSeed))
    tabs.Activity[0] = ['id', 'type']
    const { ok, output } = await run(checkSheets, { client: createFakeSheetsClient(tabs) })
    expect(ok).toBe(false)
    expect(output).toMatch(/FAIL  Tab "Activity" cannot be used/)
    expect(output).toMatch(/missing column\(s\): message, leadId, timestamp/)
  })

  it('warns (but passes) about rows broken by hand', async () => {
    const tabs = fakeSpreadsheetFromSeed(structuredClone(contractSeed))
    tabs.Leads[2][headerFor('leads').indexOf('score')] = 'n/a'
    const { ok, output } = await run(checkSheets, { client: createFakeSheetsClient(tabs) })
    expect(ok).toBe(true)
    expect(output).toMatch(/WARN  Tab "Leads" row 3 will be ignored: "score" is not a number \("n\/a"\)/)
  })

  it('never writes anything', async () => {
    const tabs = fakeSpreadsheetFromSeed(structuredClone(contractSeed))
    const client = createFakeSheetsClient(tabs)
    const before = structuredClone(client.sheets)
    await run(checkSheets, { client })
    expect(client.sheets).toEqual(before)
    expect(client.calls.appendRow).toBe(0)
  })
})
