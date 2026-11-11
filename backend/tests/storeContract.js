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
      reviewFlags: null, submissionKey: null,
    },
    {
      id: 'LD-2002', name: 'Ben Okafor', phone: '5125550102', email: 'ben@example.com', zip: '78701',
      serviceType: 'HVAC', timeline: '1-3 months', message: 'Heat pump quote.', source: 'Referral',
      classification: null, score: null, status: 'New', createdAt: '2026-11-02T10:00:00.000Z',
      qualificationStatus: 'pending', aiReason: null, aiModel: null, qualifiedAt: null,
      reviewFlags: 'too_vague', submissionKey: 'sub-key-2002',
    },
  ],
  activity: [
    { id: 'EV-1', type: 'lead', message: 'New lead LD-2001 captured', leadId: 'LD-2001', timestamp: '2026-11-01T10:00:00.000Z' },
    { id: 'EV-2', type: 'error', message: 'Validation failed', leadId: null, timestamp: '2026-11-01T11:00:00.000Z' },
  ],
  followUps: [
    {
      id: 'FU-1', leadId: 'LD-2001', channel: 'email', subject: 'About your roof leak', body: 'Hi Ana, thanks for reaching out about the roof leak. Our team will call you to arrange an inspection.',
      status: 'draft', aiModel: 'gemini-test', createdAt: '2026-11-01T10:00:06.000Z', decidedAt: null, editedAt: null, sentAt: null, sentVia: null, claimedAt: null, claimedBy: null,
    },
  ],
  agentRuns: [
    { runId: 'AR-1', leadId: 'LD-2001', agent: 'qualification', status: 'success', durationMs: 1200, errorKind: null, detail: 'Hot (score 90)', startedAt: '2026-11-01T10:00:02.000Z' },
  ],
  recoveries: [
    {
      id: 'RC-1', kind: 'qualification', targetId: 'LD-2002', status: 'pending_retry', attempts: 1,
      nextRetryAt: '2026-11-02T10:05:00.000Z', lastErrorKind: 'timeout', lastError: 'Gemini did not respond in time.',
      createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
    },
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
  reviewFlags: null, submissionKey: null,
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

    it('lists and inserts agent runs (numbers and nulls intact)', async () => {
      expect(await store.listAgentRuns()).toEqual(contractSeed.agentRuns)
      const run = { runId: 'AR-2', leadId: null, agent: 'validation', status: 'failed', durationMs: 3, errorKind: 'bug', detail: null, startedAt: '2026-11-03T10:00:00.000Z' }
      await store.insertAgentRun(run)
      const runs = await store.listAgentRuns()
      expect(runs).toContainEqual(run)
      expect(typeof runs.find((r) => r.runId === 'AR-2').durationMs).toBe('number')
    })

    it('lists, inserts and updates follow-up drafts', async () => {
      expect(await store.listFollowUps()).toEqual(contractSeed.followUps)
      const draft = { ...contractSeed.followUps[0], id: 'FU-2', subject: '=HYPERLINK("x")' }
      await store.insertFollowUp(draft)
      expect((await store.listFollowUps()).find((f) => f.id === 'FU-2').subject).toBe('=HYPERLINK("x")') // stays text

      const approved = await store.updateFollowUp('FU-1', { status: 'approved', decidedAt: '2026-11-02T09:00:00.000Z', id: 'FU-HACK' })
      expect(approved).toMatchObject({ id: 'FU-1', status: 'approved', decidedAt: '2026-11-02T09:00:00.000Z', body: contractSeed.followUps[0].body })
      expect(await store.updateFollowUp('FU-404', { status: 'approved' })).toBeNull()
      expect((await store.listFollowUps()).find((f) => f.id === 'FU-2').status).toBe('draft') // untouched
    })

    it('lists workflow runs with numbers intact', async () => {
      const [run] = await store.listWorkflowRuns()
      expect(run).toEqual(contractSeed.workflowRuns[0])
      expect(typeof run.attempts).toBe('number')
    })

    it('lists, inserts and updates recoveries (Stage 7), with numbers and nulls intact', async () => {
      expect(await store.listRecoveries()).toEqual(contractSeed.recoveries)
      const escalated = {
        id: 'RC-2', kind: 'qualification', targetId: 'LD-2001', status: 'escalated', attempts: 4,
        nextRetryAt: null, lastErrorKind: 'auth', lastError: '=HYPERLINK("x")', createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z',
      }
      await store.insertRecovery(escalated)
      expect((await store.listRecoveries()).find((r) => r.id === 'RC-2')).toEqual(escalated) // formula-like text stays text

      const done = await store.updateRecovery('RC-1', { status: 'recovered', attempts: 2, nextRetryAt: null, id: 'RC-HACK' })
      expect(done).toEqual({ ...contractSeed.recoveries[0], status: 'recovered', attempts: 2, nextRetryAt: null })
      expect(typeof done.attempts).toBe('number')
      expect(await store.updateRecovery('RC-404', { status: 'recovered' })).toBeNull()
      expect((await store.listRecoveries()).find((r) => r.id === 'RC-2').status).toBe('escalated') // untouched
    })

    it('inserts and updates workflow runs (Stage 6: real n8n runs)', async () => {
      const run = {
        id: 'WF-n8n-77', workflow: 'Send approved follow-up', leadId: null, status: 'retrying', attempts: 1, maxAttempts: 3,
        lastError: '=cmd()', startedAt: '2026-11-03T10:00:00.000Z',
      }
      await store.insertWorkflowRun(run)
      expect((await store.listWorkflowRuns()).find((r) => r.id === 'WF-n8n-77')).toEqual(run) // formula-like text stays text

      const done = await store.updateWorkflowRun('WF-n8n-77', { status: 'success', attempts: 2, lastError: null, id: 'WF-HACK' })
      expect(done).toEqual({ ...run, status: 'success', attempts: 2, lastError: null })
      expect((await store.listWorkflowRuns()).find((r) => r.id === 'WF-n8n-77')).toEqual(done)
      expect(await store.updateWorkflowRun('WF-404', { status: 'success' })).toBeNull()
      expect((await store.listWorkflowRuns()).find((r) => r.id === 'WF-1').status).toBe('failed') // untouched
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
