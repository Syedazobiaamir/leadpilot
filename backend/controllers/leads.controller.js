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
  const lead = await leadService.createLead(req.body)
  // 201 Created, plus a Location header pointing to the new resource (a REST convention).
  res.status(201).location(`/api/leads/${lead.id}`).json({ data: lead })
}

export async function getLead(req, res) {
  const lead = await leadService.getLeadById(req.params.id)
  res.json({ data: lead })
}
