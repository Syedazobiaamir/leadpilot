// Follow-up drafts (Stage 5). The AI writes drafts; these endpoints let PEOPLE read and decide.
import { followUps } from '../services/followUpService.js'
import { checkLeadId } from '../services/leadService.js'

export async function listLeadFollowUps(req, res) {
  checkLeadId(req.params.id)
  const items = await followUps().listForLead(req.params.id)
  res.json({ data: items, count: items.length })
}

export async function requestFollowUp(req, res) {
  checkLeadId(req.params.id)
  // 202 Accepted: the Follow-up Agent writes the draft in the background (a few seconds).
  res.status(202).json({ data: await followUps().requestDraft(req.params.id) })
}

export async function approveFollowUp(req, res) {
  res.json({ data: await followUps().approve(req.params.id) })
}

export async function rejectFollowUp(req, res) {
  res.json({ data: await followUps().reject(req.params.id) })
}

export async function editFollowUp(req, res) {
  res.json({ data: await followUps().edit(req.params.id, req.body) })
}
