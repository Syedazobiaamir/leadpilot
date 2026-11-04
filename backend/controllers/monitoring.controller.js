import * as monitoringService from '../services/monitoringService.js'

export async function listActivity(req, res) {
  const events = await monitoringService.getActivity()
  res.json({ data: events, count: events.length })
}

export async function listWorkflowRuns(req, res) {
  const runs = await monitoringService.getWorkflowRuns()
  res.json({ data: runs, count: runs.length })
}
