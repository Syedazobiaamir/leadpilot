import { beforeEach, describe, expect, it } from 'vitest'
import { createLead, getActivity, getLeads, resetData } from './leadService.js'

const newLead = {
  name: 'Tom Rivera',
  phone: '512-555-0199',
  email: 'tom.rivera@example.com',
  zip: '78702',
  serviceType: 'Siding',
  timeline: 'Within 1 month',
  message: 'Need new siding on a two-story house.',
}

describe('leadService', () => {
  beforeEach(() => resetData())

  it('returns leads sorted newest first', async () => {
    const leads = await getLeads()
    expect(leads.length).toBeGreaterThan(0)
    const dates = leads.map((l) => l.createdAt)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('creates a valid lead as New and unclassified, and logs an activity event', async () => {
    const before = (await getLeads()).length
    const result = await createLead(newLead)

    expect(result.success).toBe(true)
    expect(result.lead).toMatchObject({ status: 'New', classification: null, name: 'Tom Rivera' })
    expect(await getLeads()).toHaveLength(before + 1)

    const [latestEvent] = await getActivity()
    expect(latestEvent.leadId).toBe(result.lead.id)
  })

  it('rejects invalid input even if the UI is bypassed', async () => {
    const result = await createLead({ ...newLead, zip: 'bad' })
    expect(result.success).toBe(false)
    expect(result.errors.zip).toBeDefined()
  })

  it('rejects a duplicate email or phone', async () => {
    await createLead(newLead)
    const dupEmail = await createLead({ ...newLead, phone: '512-555-0100' })
    expect(dupEmail.success).toBe(false)
    expect(dupEmail.errors.form).toMatch(/already exists/)

    const dupPhone = await createLead({ ...newLead, email: 'other@example.com', phone: '(512) 555-0199' })
    expect(dupPhone.success).toBe(false)
  })
})
