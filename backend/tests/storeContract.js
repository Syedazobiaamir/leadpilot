// The STORE CONTRACT: rules every store (memory, sheets) must follow.
// Each store's test file calls runStoreContract() with a function that builds that
// store from seed data. If both stores pass, the services can use either one safely.
//
// This file has no ".test" in its name: it's a helper that test files import.
import { beforeEach, describe, expect, it } from 'vitest'

// Small, store-independent test data (deliberately NOT the app's sample data).
export const contractSeed = {
  leads: [
    {
      id: 'LD-2001', name: 'Ana Lopez', phone: '5125550101', email: 'ana@example.com', zip: '02134',
      serviceType: 'Roofing', timeline: 'ASAP', message: 'Roof leak after storm.', source: 'Website form',
      classification: 'Hot', score: 90, status: 'New', createdAt: '2026-11-01T10:00:00.000Z',
      qualificationStatus: 'qualified', aiReason: 'Roof leak after storm.', aiModel: 'simulated', qualifiedAt: '2026-11-01T10:00:04.000Z',
    },
    {
      id: 'LD-2002', name: 'Ben Okafor', phone: '5125550102', email: 'ben@example.com', zip: '78701',
      serviceType: 'HVAC', timeline: '1-3 months', message: 'Heat pump quote.', source: 'Referral',
      classification: null, score: null, status: 'New', createdAt: '2026-11-02T10:00:00.000Z',
      qualificationStatus: 'pending', aiReason: null, aiModel: null, qualifiedAt: null,
    },
  ],
  activity: [
    { id: 'EV-1', type: 'lead', message: 'New lead LD-2001 captured', leadId: 'LD-2001', timestamp: '2026-11-01T10:00:00.000Z' },
    { id: 'EV-2', type: 'error', message: 'Validation failed', leadId: null, timestamp: '2026-11-01T11:00:00.000Z' },
  ],
  workflowRuns: [
    {
      id: 'WF-1', workflow: 'AI qualification', leadId: 'LD-2001', status: 'failed', attempts: 3, maxAttempts: 3,
      lastError: 'Timeout', startedAt: '2026-11-01T10:00:05.000Z',
    },
  ],
}

const newLead = {
  id: 'LD-2003', name: 'Cara Diaz', phone: '+1 512-555-0103', email: 'cara@example.com', zip: '78702',
  serviceType: 'Solar', timeline: 'Just researching', message: 'Solar panel costs?', source: 'Website form',
  classification: null, score: null, status: 'New', createdAt: '2026-11-03T10:00:00.000Z',
  qualificationStatus: 'pending', aiReason: null, aiModel: null, qualifiedAt: null,
}

/**
 * name:      label shown in the test output, e.g. 'memory'
 * makeStore: async (seed) => a fresh store containing exactly that seed data
 */
export function runStoreContract(name, makeStore) {
  describe(`store contract: ${name}`, () => {
    let store
    beforeEach(async () => {
      store = await makeStore(structuredClone(contractSeed))
    })

    it('has a name', () => {
      expect(typeof store.name).toBe('string')
    })

    it('lists the seeded leads with every field and type intact', async () => {
      const leads = await store.listLeads()
      expect(leads).toHaveLength(2)
      expect(leads).toEqual(expect.arrayContaining(contractSeed.leads))
    })

    it('keeps leading zeros, nulls and numbers exactly (ZIP 02134, null score, score 90)', async () => {
      const ana = await store.findLeadById('LD-2001')
      expect(ana.zip).toBe('02134')
      expect(ana.score).toBe(90)
      const ben = await store.findLeadById('LD-2002')
      expect(ben.classification).toBeNull()
      expect(ben.score).toBeNull()
    })

    it('finds a lead by ID, and returns null for an unknown ID', async () => {
      expect((await store.findLeadById('LD-2002')).name).toBe('Ben Okafor')
      expect(await store.findLeadById('LD-9999')).toBeNull()
    })

    it('inserts a lead that can then be found and listed', async () => {
      const returned = await store.insertLead(newLead)
      expect(returned).toEqual(newLead)
      expect(await store.findLeadById('LD-2003')).toEqual(newLead)
      expect(await store.listLeads()).toHaveLength(3)
    })

    it('stores text that looks like a formula as plain text', async () => {
      const sneaky = { ...newLead, id: 'LD-2004', name: '=HYPERLINK("http://evil.example","Click")' }
      await store.insertLead(sneaky)
      expect((await store.findLeadById('LD-2004')).name).toBe(sneaky.name)
    })

    it('lists and inserts activity events (including a null leadId)', async () => {
      expect(await store.listActivity()).toEqual(expect.arrayContaining(contractSeed.activity))
      const event = { id: 'EV-3', type: 'lead', message: 'New lead LD-2003 captured', leadId: 'LD-2003', timestamp: '2026-11-03T10:00:00.000Z' }
      await store.insertActivity(event)
      expect(await store.listActivity()).toContainEqual(event)
    })

    it('lists workflow runs with numbers intact', async () => {
      const [run] = await store.listWorkflowRuns()
      expect(run).toEqual(contractSeed.workflowRuns[0])
      expect(typeof run.attempts).toBe('number')
    })

    it('returns copies: changing a returned object does not change the store', async () => {
      const leads = await store.listLeads()
      leads[0].name = 'CHANGED'
      const found = await store.findLeadById(leads[0].id)
      found.status = 'CHANGED'
      const again = await store.findLeadById(leads[0].id)
      expect(again.name).not.toBe('CHANGED')
      expect(again.status).not.toBe('CHANGED')
    })

    it('updateLead changes only the given fields and returns the updated lead', async () => {
      const changes = { classification: 'Warm', score: 64, qualificationStatus: 'qualified', aiReason: 'Wants a heat pump quote.', aiModel: 'test-model', qualifiedAt: '2026-11-05T10:00:00.000Z' }
      const updated = await store.updateLead('LD-2002', changes)

      expect(updated).toEqual({ ...contractSeed.leads[1], ...changes })
      expect(await store.findLeadById('LD-2002')).toEqual(updated)
      // Other leads are untouched
      expect(await store.findLeadById('LD-2001')).toEqual(contractSeed.leads[0])
      expect(await store.listLeads()).toHaveLength(2)
    })

    it('updateLead returns null for an unknown ID and changes nothing', async () => {
      expect(await store.updateLead('LD-9999', { score: 1 })).toBeNull()
      expect(await store.listLeads()).toEqual(expect.arrayContaining(contractSeed.leads))
    })

    it('updateLead can never change a lead ID', async () => {
      const updated = await store.updateLead('LD-2002', { id: 'LD-7777', score: 10 })
      expect(updated.id).toBe('LD-2002')
      expect(await store.findLeadById('LD-7777')).toBeNull()
    })

    it('updateLead can set a field back to null', async () => {
      await store.updateLead('LD-2001', { aiReason: null, classification: null, score: null })
      const lead = await store.findLeadById('LD-2001')
      expect(lead).toMatchObject({ aiReason: null, classification: null, score: null, name: 'Ana Lopez' })
    })

    it('keeps a copy on insert: changing the input afterwards does not change the store', async () => {
      const input = structuredClone(newLead)
      await store.insertLead(input)
      input.name = 'CHANGED'
      expect((await store.findLeadById('LD-2003')).name).toBe('Cara Diaz')
    })
  })
}
