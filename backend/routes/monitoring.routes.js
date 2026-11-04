// URL → controller mapping for monitoring data
import { Router } from 'express'
import { listActivity, listWorkflowRuns } from '../controllers/monitoring.controller.js'

const router = Router()

router.get('/activity', listActivity) //            GET /api/activity
router.get('/workflow-runs', listWorkflowRuns) //   GET /api/workflow-runs

export default router
