// URL → controller mapping for the endpoints ONLY n8n may call (Stage 6).
// Every route here needs the header  x-automation-key: <AUTOMATION_SECRET>
import { Router } from 'express'
import { requireAutomationKey } from '../middleware/requireAutomationKey.js'
import { checkConnection, getFollowUpStatus, markFollowUpSent, recordActivity, recordWorkflowRun } from '../controllers/automation.controller.js'

const router = Router()

router.use(requireAutomationKey()) // runs before every route below

router.get('/check', checkConnection) //                         GET  /api/automation/check
router.post('/workflow-runs', recordWorkflowRun) //              POST /api/automation/workflow-runs
router.post('/activity', recordActivity) //                      POST /api/automation/activity (alerts for the dashboard)
router.get('/followups/:id', getFollowUpStatus) //               GET  /api/automation/followups/FU-...  (check before delivering)
router.post('/followups/:id/mark-sent', markFollowUpSent) //     POST /api/automation/followups/FU-.../mark-sent

export default router
