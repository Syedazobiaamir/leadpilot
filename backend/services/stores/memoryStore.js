// In-memory store: keeps data in plain arrays. Resets when the server restarts.
// Used by default and by all automated tests.
//
// Every store (memory, sheets) has the SAME functions:
//   listLeads, findLeadById, insertLead, updateLead, listActivity, insertActivity,
//   listWorkflowRuns, insertWorkflowRun, updateWorkflowRun, follow-ups, agent runs, recoveries, ping
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
  let agentRuns = []
  let followUps = []
  let recoveries = []

  // structuredClone makes deep copies, so the store and its callers never share objects.
  function reset() {
    leads = structuredClone(seed.leads ?? [])
    activity = structuredClone(seed.activity ?? [])
    workflowRuns = structuredClone(seed.workflowRuns ?? [])
    agentRuns = structuredClone(seed.agentRuns ?? [])
    followUps = structuredClone(seed.followUps ?? [])
    recoveries = structuredClone(seed.recoveries ?? [])
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
    async insertWorkflowRun(run) {
      workflowRuns.push(structuredClone(run))
      return structuredClone(run)
    },
    async updateWorkflowRun(id, changes) {
      const index = workflowRuns.findIndex((r) => r.id === id)
      if (index === -1) return null
      workflowRuns[index] = { ...workflowRuns[index], ...structuredClone(changes), id }
      return structuredClone(workflowRuns[index])
    },
    async listFollowUps() {
      return structuredClone(followUps)
    },
    async insertFollowUp(followUp) {
      followUps.push(structuredClone(followUp))
      return structuredClone(followUp)
    },
    async updateFollowUp(id, changes) {
      const index = followUps.findIndex((f) => f.id === id)
      if (index === -1) return null
      followUps[index] = { ...followUps[index], ...structuredClone(changes), id }
      return structuredClone(followUps[index])
    },
    async listRecoveries() {
      return structuredClone(recoveries)
    },
    async insertRecovery(recovery) {
      recoveries.push(structuredClone(recovery))
      return structuredClone(recovery)
    },
    async updateRecovery(id, changes) {
      const index = recoveries.findIndex((r) => r.id === id)
      if (index === -1) return null
      recoveries[index] = { ...recoveries[index], ...structuredClone(changes), id }
      return structuredClone(recoveries[index])
    },
    async listAgentRuns() {
      return structuredClone(agentRuns)
    },
    async insertAgentRun(run) {
      agentRuns.push(structuredClone(run))
      return structuredClone(run)
    },
    /** Readiness check. Memory is always reachable. */
    async ping() {
      return true
    },
  }
}
