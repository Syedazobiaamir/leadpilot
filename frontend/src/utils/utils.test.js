import { describe, expect, it } from 'vitest'
import { activityHighlight, formatDateTime, formatPercent, formatPhone, workflowRunSource } from './formatters.js'
import { computeLeadStats, computeWorkflowStats, filterLeads } from './leadStats.js'

const leads = [
  { name: 'A Hot', email: 'a@example.com', serviceType: 'Roofing', zip: '78701', classification: 'Hot', status: 'Won' },
  { name: 'B Hot', email: 'b@example.com', serviceType: 'HVAC', zip: '30309', classification: 'Hot', status: 'New' },
  { name: 'C Warm', email: 'c@example.com', serviceType: 'Plumbing', zip: '92101', classification: 'Warm', status: 'Won' },
  { name: 'D Cold', email: 'd@example.com', serviceType: 'Solar', zip: '85004', classification: 'Cold', status: 'Lost' },
  { name: 'E New', email: 'e@example.com', serviceType: 'Roofing', zip: '60614', classification: null, status: 'New' },
]

describe('computeLeadStats', () => {
  it('counts classifications, pending and won leads', () => {
    const stats = computeLeadStats(leads)
    expect(stats).toMatchObject({ total: 5, hot: 2, warm: 1, cold: 1, pending: 1, won: 2 })
    expect(stats.conversionRate).toBeCloseTo(0.4)
  })

  it('returns a 0 conversion rate (not NaN) for no leads', () => {
    expect(computeLeadStats([]).conversionRate).toBe(0)
  })
})

describe('computeWorkflowStats', () => {
  it('counts statuses and success rate', () => {
    const runs = [{ status: 'success' }, { status: 'success' }, { status: 'failed' }, { status: 'escalated' }]
    const stats = computeWorkflowStats(runs)
    expect(stats).toMatchObject({ total: 4, success: 2, failed: 1, escalated: 1, retrying: 0 })
    expect(stats.successRate).toBe(0.5)
  })
})

describe('filterLeads', () => {
  it('returns all leads with default filters', () => {
    expect(filterLeads(leads)).toHaveLength(5)
  })

  it('filters by classification, including Pending', () => {
    expect(filterLeads(leads, { classification: 'Hot' })).toHaveLength(2)
    expect(filterLeads(leads, { classification: 'Pending' }).map((l) => l.name)).toEqual(['E New'])
  })

  it('combines classification, status and case-insensitive search', () => {
    expect(filterLeads(leads, { classification: 'Hot', status: 'Won' })).toHaveLength(1)
    expect(filterLeads(leads, { search: 'roofing' })).toHaveLength(2)
    expect(filterLeads(leads, { search: '92101' })[0].name).toBe('C Warm')
  })
})

describe('formatters', () => {
  it('formats US phone numbers', () => {
    expect(formatPhone('5125550147')).toBe('(512) 555-0147')
    expect(formatPhone('+1 512-555-0147')).toBe('(512) 555-0147')
    expect(formatPhone('12345')).toBe('12345') // can't format: unchanged
  })

  it('formats percentages and handles NaN', () => {
    expect(formatPercent(0.4567)).toBe('45.7%')
    expect(formatPercent(NaN)).toBe('0%')
  })

  it('formats dates and reports invalid ones', () => {
    expect(formatDateTime('2026-11-03T14:05:00Z')).toMatch(/Nov \d, 2026/)
    expect(formatDateTime('garbage')).toBe('Unknown date')
  })
})

describe('workflowRunSource (Stage 6)', () => {
  it('tells real n8n runs, failed backend deliveries and sample data apart', () => {
    expect(workflowRunSource('WF-n8n-17')).toBe('n8n')
    expect(workflowRunSource('WF-be-1731-1')).toBe('backend')
    expect(workflowRunSource('WF-9031')).toBe('sample')
    expect(workflowRunSource(undefined)).toBe('sample')
  })
})

describe('activityHighlight (Stage 6)', () => {
  it('marks escalations and hot-lead alerts, nothing else', () => {
    expect(activityHighlight({ type: 'escalation', message: 'NEEDS A PERSON: ...' })).toBe('needs-person')
    expect(activityHighlight({ type: 'automation', message: 'HOT LEAD LD-1012: Linda, HVAC' })).toBe('hot')
    expect(activityHighlight({ type: 'automation', message: 'Follow-up FU-1 sent by n8n' })).toBeNull()
    expect(activityHighlight({ type: 'lead', message: 'a hot lead was captured' })).toBeNull()
  })
})
