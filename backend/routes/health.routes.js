// Health checks, used by monitoring tools (and n8n in Stage 6):
//
//   GET /api/health        LIVENESS:  "the server process is running"
//                          Cheap, never touches storage. If this fails, restart the server.
//   GET /api/health/ready  READINESS: "the server can do its job right now"
//                          Checks the storage (Google Sheets) is reachable and set up correctly.
//                          If this fails, the server is fine but something it depends on isn't.
import { Router } from 'express'
import { pingStore, storeName } from '../services/leadStore.js'

const router = Router()

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    store: storeName,
    uptimeSeconds: Math.round(process.uptime()), // how long the server has been running
    timestamp: new Date().toISOString(),
  })
})

router.get('/ready', async (req, res) => {
  await pingStore() // throws 503 STORAGE_UNAVAILABLE if storage isn't usable
  res.json({ status: 'ready', store: storeName, timestamp: new Date().toISOString() })
})

export default router
