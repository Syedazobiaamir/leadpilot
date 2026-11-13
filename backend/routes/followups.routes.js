// URL → controller mapping for follow-up drafts (Stage 5)
import { Router } from 'express'
import { approveFollowUp, editFollowUp, rejectFollowUp } from '../controllers/followups.controller.js'
import { requireStaff } from '../middleware/requireStaff.js'

const router = Router()

router.use(requireStaff) // Stage 8: staff only

router.patch('/:id', editFollowUp) //          PATCH /api/followups/FU-...          (body: { subject, body })
router.post('/:id/approve', approveFollowUp) // POST  /api/followups/FU-.../approve
router.post('/:id/reject', rejectFollowUp) //   POST  /api/followups/FU-.../reject

export default router
