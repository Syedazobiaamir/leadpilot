// URL → controller mapping for /api/leads
import { Router } from 'express'
import { createLead, getLead, listLeads, qualifyLead } from '../controllers/leads.controller.js'
import { listLeadFollowUps, requestFollowUp } from '../controllers/followups.controller.js'

const router = Router()

router.get('/', listLeads) //      GET /api/leads
router.post('/', createLead) //    POST /api/leads   (body: lead fields as JSON)
router.post('/:id/qualify', qualifyLead) // POST /api/leads/LD-1001/qualify  (AI, runs in the background)
router.get('/:id/followups', listLeadFollowUps) //  GET  /api/leads/LD-1001/followups
router.post('/:id/followups', requestFollowUp) //  POST /api/leads/LD-1001/followups (AI draft, background)
router.get('/:id', getLead) //     GET /api/leads/LD-1001  (":id" becomes req.params.id)

export default router
