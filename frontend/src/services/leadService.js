// The data access layer. Components never touch the data directly; they call
// these functions instead.
// Stage 1: functions read from in-memory sample data and wait a moment to
// imitate a network request.
// Stage 2: only this file changes, to call the Express API with fetch(), and
// the components keep working without changes.
import { sampleLeads } from '../data/sampleLeads.js'
import { sampleActivity } from '../data/sampleActivity.js'
import { sampleWorkflowRuns } from '../data/sampleWorkflowRuns.js'
import { validateLead } from '../validation/leadSchema.js'

// No artificial delay in tests, so tests stay fast.
const SIMULATED_DELAY_MS = import.meta.env.MODE === 'test' ? 0 : 300

// In-memory "database". It resets when the page reloads. That's a known Stage 1 limitation.
let leads = []
let activity = []
let workflowRuns = []
let nextLeadNumber = 1

/** Restores the sample data. Used on startup and by tests. */
export function resetData() {
  leads = sampleLeads.map((lead) => ({ ...lead }))
  activity = sampleActivity.map((event) => ({ ...event }))
  workflowRuns = sampleWorkflowRuns.map((run) => ({ ...run }))
  nextLeadNumber = 1001 + leads.length
}
resetData()

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Returns all leads, newest first. Copies are returned so callers can't mutate our "database". */
export async function getLeads() {
  await wait(SIMULATED_DELAY_MS)
  return [...leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Returns activity events, newest first. */
export async function getActivity() {
  await wait(SIMULATED_DELAY_MS)
  return [...activity].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

/** Returns workflow runs, newest first. */
export async function getWorkflowRuns() {
  await wait(SIMULATED_DELAY_MS)
  return [...workflowRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * Creates a lead after validating it.
 * The service validates again even though the form already did, because you
 * should never trust input just because the UI checked it. The backend will
 * follow the same rule.
 * Returns { success: true, lead } or { success: false, errors }.
 */
export async function createLead(input) {
  await wait(SIMULATED_DELAY_MS)

  const result = validateLead(input)
  if (!result.success) {
    return { success: false, errors: result.errors }
  }

  // Simple duplicate protection: the same email or phone already exists.
  const digits = (value) => value.replace(/\D/g, '').slice(-10)
  const duplicate = leads.find(
    (lead) => lead.email === result.data.email || digits(lead.phone) === digits(result.data.phone),
  )
  if (duplicate) {
    return {
      success: false,
      errors: { form: `A lead with this email or phone already exists (${duplicate.id}).` },
    }
  }

  const now = new Date().toISOString()
  const lead = {
    id: `LD-${nextLeadNumber++}`,
    ...result.data,
    source: 'Website form',
    classification: null, // AI qualification is not connected yet (Stage 4)
    score: null,
    status: 'New',
    createdAt: now,
  }
  leads.push(lead)
  activity.push({
    id: `EV-${Date.now()}`,
    type: 'lead',
    message: `New lead ${lead.id} captured from website form (AI qualification pending, simulated)`,
    leadId: lead.id,
    timestamp: now,
  })

  return { success: true, lead: { ...lead } }
}
