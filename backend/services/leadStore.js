// The data store: the ONLY file that knows where data is kept.
// Stage 2: plain arrays in memory, seeded with sample data (reset on restart).
// Stage 3: these same functions will read and write Google Sheets instead.
//
// Every function is async even though arrays are instant. Google Sheets calls
// WILL be async (network requests), so if the interface is async now, the code
// that calls it doesn't need to change in Stage 3.
import { sampleLeads } from '../data/sampleLeads.js'
import { sampleActivity } from '../data/sampleActivity.js'
import { sampleWorkflowRuns } from '../data/sampleWorkflowRuns.js'

let leads = []
let activity = []
let workflowRuns = []

/** Restores the sample data. Runs once at startup, and before each test. */
export function resetStore() {
  // structuredClone makes deep copies, so changes never touch the original sample arrays.
  leads = structuredClone(sampleLeads)
  activity = structuredClone(sampleActivity)
  workflowRuns = structuredClone(sampleWorkflowRuns)
}
resetStore()

// Callers always get copies. If a caller changes an object it received,
// our stored data stays unchanged. A real database behaves the same way.

export async function listLeads() {
  return structuredClone(leads)
}

export async function findLeadById(id) {
  const lead = leads.find((l) => l.id === id)
  return lead ? structuredClone(lead) : null
}

export async function insertLead(lead) {
  leads.push(structuredClone(lead))
  return structuredClone(lead)
}

export async function listActivity() {
  return structuredClone(activity)
}

export async function insertActivity(event) {
  activity.push(structuredClone(event))
  return structuredClone(event)
}

export async function listWorkflowRuns() {
  return structuredClone(workflowRuns)
}
