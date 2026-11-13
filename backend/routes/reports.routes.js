// URL → controller mapping for reports (Stage 8). Staff only.
import { Router } from 'express'
import { getOverview } from '../controllers/reports.controller.js'
import { requireStaff } from '../middleware/requireStaff.js'

const router = Router()

router.get('/overview', requireStaff, getOverview) // GET /api/reports/overview

export default router
