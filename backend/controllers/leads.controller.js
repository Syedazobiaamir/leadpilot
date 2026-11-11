// Controllers are the bridge between HTTP and business logic:
// read from the request → call the service → send the response.
// They stay thin. No business rules here.
// If the service throws, Express 5 passes the error to errorHandler automatically.
import * as leadService from '../services/leadService.js'

export async function listLeads(req, res) {
  const leads = await leadService.getLeads()
  res.json({ data: leads, count: leads.length })
}

export async function createLead(req, res) {
  const { lead, replayed } = await leadService.createLead(req.body, { idempotencyKey: req.get('Idempotency-Key') })
  // 201 Created, plus a Location header pointing to the new resource (a REST convention).
  // A replay (same Idempotency-Key again) gets the same answer, marked with a header.
  if (replayed) res.set('Idempotent-Replayed', 'true')
  res.status(201).location(`/api/leads/${lead.id}`).json({ data: lead })
}

export async function qualifyLead(req, res) {
  const lead = await leadService.requalifyLead(req.params.id)
  // 202 Accepted: "we started the work". The result appears on the lead in a few seconds.
  res.status(202).json({ data: lead })
}

export async function getLead(req, res) {
  const lead = await leadService.getLeadById(req.params.id)
  res.json({ data: lead })
}
