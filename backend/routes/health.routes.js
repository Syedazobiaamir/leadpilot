// Health checks, used by monitoring tools (and n8n in Stage 6):
//
//   GET /api/health        LIVENESS:  "the server process is running"
//                          Cheap, never touches storage. If this fails, restart the server.
//   GET /api/health/ready  READINESS: "the server can do its job right now"
//                          Checks the storage (Google Sheets) is reachable and set up correctly.
//                          If this fails, the server is fine but something it depends on isn't.
import { Router } from 'express'
import { pingStore, storeName } from '../services/leadStore.js'
import { qualification } from '../services/qualificationService.js'
import { automation } from '../services/automationService.js'
import { config } from '../config.js'

const router = Router()

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    store: storeName,
    ai: qualification().model ?? 'disabled', // AI is optional: "disabled" does not make the server unhealthy
    automation: automation().outboundEnabled ? 'n8n' : 'disabled', // also optional (Stage 6)
    uptimeSeconds: Math.round(process.uptime()), // how long the server has been running
    timestamp: new Date().toISOString(),
  })
})

// Stage 8: one real check is reused for config.readyCacheMs (30 s). Without this, anyone calling
// /ready fast could use up the Google Sheets read quota (it happened in a Stage 7 drill: 7 reads
// per call, 60 allowed per minute). Requests arriving together also share one check.
let lastCheck = null // { at, result: Promise<{ ok, error? }> }

router.get('/ready', async (req, res) => {
  const now = Date.now()
  if (!lastCheck || now - lastCheck.at >= config.readyCacheMs) {
    lastCheck = {
      at: now,
      result: pingStore().then( // throws 503 STORAGE_UNAVAILABLE if storage isn't usable
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      ),
    }
  }
  const { at, result } = lastCheck
  const outcome = await result
  if (!outcome.ok) throw outcome.error
  res.json({ status: 'ready', store: storeName, checkedAt: new Date(at).toISOString(), timestamp: new Date().toISOString() })
})

export default router
