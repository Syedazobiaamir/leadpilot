// In-memory store: keeps data in plain arrays. Resets when the server restarts.
// Used by default and by all automated tests.
//
// Every store (memory, sheets) has the SAME functions:
//   listLeads, findLeadById, insertLead, listActivity, insertActivity, listWorkflowRuns
// All are async and all return COPIES. tests/storeContract.test.js checks
// that every store follows these rules.

/**
 * Creates a memory store.
 * seed: the starting data { leads, activity, workflowRuns }. It's copied, never changed.
 */
export function createMemoryStore(seed) {
  let leads = []
  let activity = []
  let workflowRuns = []

  // structuredClone makes deep copies, so the store and its callers never share objects.
  function reset() {
    leads = structuredClone(seed.leads ?? [])
    activity = structuredClone(seed.activity ?? [])
    workflowRuns = structuredClone(seed.workflowRuns ?? [])
  }
  reset()

  return {
    name: 'memory',
    reset, // only the memory store can be reset (used by tests)

    async listLeads() {
      return structuredClone(leads)
    },
    async findLeadById(id) {
      const lead = leads.find((l) => l.id === id)
      return lead ? structuredClone(lead) : null
    },
    async insertLead(lead) {
      leads.push(structuredClone(lead))
      return structuredClone(lead)
    },
    /** Changes some fields of one lead. Returns the updated lead, or null if the ID doesn't exist. */
    async updateLead(id, changes) {
      const index = leads.findIndex((l) => l.id === id)
      if (index === -1) return null
      leads[index] = { ...leads[index], ...structuredClone(changes), id } // the ID itself can never be changed
      return structuredClone(leads[index])
    },
    async listActivity() {
      return structuredClone(activity)
    },
    async insertActivity(event) {
      activity.push(structuredClone(event))
      return structuredClone(event)
    },
    async listWorkflowRuns() {
      return structuredClone(workflowRuns)
    },
    /** Readiness check. Memory is always reachable. */
    async ping() {
      return true
    },
  }
}
