// Chooses WHERE data is kept, based on config.dataStore, and exposes one set of
// functions to the services. The services never know (or care) which store is active.
//
//   memory → stores/memoryStore.js, seeded with SIMULATED sample data (the default)
//   sheets → stores/sheetsStore.js, Google Sheets (needs the GOOGLE_* settings)
import { config } from '../config.js'
import { createMemoryStore } from './stores/memoryStore.js'
import { createSheetsStore } from './stores/sheetsStore.js'
import { createSheetsClient } from './stores/sheetsClient.js'
import { sampleLeads } from '../data/sampleLeads.js'
import { sampleActivity } from '../data/sampleActivity.js'
import { sampleWorkflowRuns } from '../data/sampleWorkflowRuns.js'

function createStore(type) {
  if (type === 'memory') {
    return createMemoryStore({ leads: sampleLeads, activity: sampleActivity, workflowRuns: sampleWorkflowRuns })
  }
  if (type === 'sheets') {
    // config.google has already been checked: the server won't start if a setting is missing.
    const client = createSheetsClient({ ...config.google, timeoutMs: config.sheetsTimeoutMs })
    return createSheetsStore({ client, cacheMs: config.sheetsCacheMs })
  }
  // Never silently fall back to memory: someone could believe leads are saved when they aren't.
  throw new Error(`Unknown DATA_STORE "${type}"`)
}

const store = createStore(config.dataStore)

/** Which store is active ('memory' or 'sheets'). Used by health checks and logs. */
export const storeName = store.name

/** Restores the sample data (memory store only). Used before each test. */
export function resetStore() {
  if (!store.reset) throw new Error(`The ${store.name} store cannot be reset`)
  store.reset()
}

// The store interface used by the services.
export const listLeads = () => store.listLeads()
export const findLeadById = (id) => store.findLeadById(id)
export const insertLead = (lead) => store.insertLead(lead)
export const updateLead = (id, changes) => store.updateLead(id, changes)
export const listActivity = () => store.listActivity()
export const insertActivity = (event) => store.insertActivity(event)
export const listWorkflowRuns = () => store.listWorkflowRuns()
export const insertWorkflowRun = (run) => store.insertWorkflowRun(run)
export const updateWorkflowRun = (id, changes) => store.updateWorkflowRun(id, changes)
export const listFollowUps = () => store.listFollowUps()
export const insertFollowUp = (followUp) => store.insertFollowUp(followUp)
export const updateFollowUp = (id, changes) => store.updateFollowUp(id, changes)
export const listRecoveries = () => store.listRecoveries()
export const insertRecovery = (recovery) => store.insertRecovery(recovery)
export const updateRecovery = (id, changes) => store.updateRecovery(id, changes)
export const listAgentRuns = () => store.listAgentRuns()
export const insertAgentRun = (run) => store.insertAgentRun(run)
/** Resolves if storage is reachable and correctly set up. Otherwise throws a 503 AppError. */
export const pingStore = () => store.ping()
