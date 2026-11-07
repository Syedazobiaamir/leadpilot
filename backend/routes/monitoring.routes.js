// URL → controller mapping for monitoring data
import { Router } from 'express'
import { listActivity, listAgentRuns, listWorkflowRuns } from '../controllers/monitoring.controller.js'

const router = Router()

router.get('/activity', listActivity) //            GET /api/activity
router.get('/workflow-runs', listWorkflowRuns) //   GET /api/workflow-runs
router.get('/agent-runs', listAgentRuns) //         GET /api/agent-runs  (Stage 5: real agent activity)

export default router
