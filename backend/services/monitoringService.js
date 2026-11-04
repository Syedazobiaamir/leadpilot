// Read-only access to the activity log and automation workflow runs.
import * as store from './leadStore.js'

/** Activity events, newest first. */
export async function getActivity() {
  const events = await store.listActivity()
  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

/** Workflow runs, newest first. */
export async function getWorkflowRuns() {
  const runs = await store.listWorkflowRuns()
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
