// URL → controller mapping for /api/leads
import { Router } from 'express'
import { createLead, getLead, listLeads, qualifyLead } from '../controllers/leads.controller.js'
import { listLeadFollowUps, requestFollowUp } from '../controllers/followups.controller.js'
import { leadCreateLimiter } from '../middleware/limiters.js'
import { requireStaff } from '../middleware/requireStaff.js'

const router = Router()

// Stage 8: ONLY the form submission is public. Everything below needs a staff login.
router.post('/', leadCreateLimiter, createLead) //    POST /api/leads   (PUBLIC form; max 10 per minute per IP)
router.use(requireStaff)

router.get('/', listLeads) //      GET /api/leads
router.post('/:id/qualify', qualifyLead) // POST /api/leads/LD-1001/qualify  (AI, runs in the background)
router.get('/:id/followups', listLeadFollowUps) //  GET  /api/leads/LD-1001/followups
router.post('/:id/followups', requestFollowUp) //  POST /api/leads/LD-1001/followups (AI draft, background)
router.get('/:id', getLead) //     GET /api/leads/LD-1001  (":id" becomes req.params.id)

export default router
