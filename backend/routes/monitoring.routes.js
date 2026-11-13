// URL → controller mapping for monitoring data. Stage 8: every route here is staff only.
import { Router } from 'express'
import { listActivity, listAgentRuns, listRecoveries, listWorkflowRuns } from '../controllers/monitoring.controller.js'
import { requireStaff } from '../middleware/requireStaff.js'

const router = Router()

router.get('/activity', requireStaff, listActivity) //            GET /api/activity
router.get('/workflow-runs', requireStaff, listWorkflowRuns) //   GET /api/workflow-runs
router.get('/agent-runs', requireStaff, listAgentRuns) //         GET /api/agent-runs  (Stage 5: real agent activity)
router.get('/recoveries', requireStaff, listRecoveries) //         GET /api/recoveries  (Stage 7: self-healing records)

export default router
