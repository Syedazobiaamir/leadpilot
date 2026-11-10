// Endpoints that only n8n calls (Stage 6). requireAutomationKey runs before all of them.
import { automation } from '../services/automationService.js'
import { followUps } from '../services/followUpService.js'

/** n8n checks that its credential works (used when setting up the workflows). */
export function checkConnection(req, res) {
  res.json({ data: { status: 'ok', timestamp: new Date().toISOString() } })
}

/** n8n reports a workflow run. 201 the first time, 200 when it updates the same execution. */
export async function recordWorkflowRun(req, res) {
  const { run, created } = await automation().recordRun(req.body)
  res.status(created ? 201 : 200).json({ data: run })
}

/** n8n checks a follow-up is still approved BEFORE delivering it (only id, leadId, status, sentAt). */
export async function getFollowUpStatus(req, res) {
  res.json({ data: await followUps().deliveryStatus(req.params.id) })
}

/** n8n says it sent an approved follow-up. Safe to call twice (alreadySent: true the 2nd time). */
export async function markFollowUpSent(req, res) {
  const { followUp, alreadySent } = await followUps().markSent(req.params.id, req.body)
  res.json({ data: followUp, alreadySent })
}

/** n8n writes an alert to the activity log. 201 the first time, 200 if this run already wrote one. */
export async function recordActivity(req, res) {
  const { event, created } = await automation().recordActivity(req.body)
  res.status(created ? 201 : 200).json({ data: event })
}
