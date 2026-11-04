// Health check: a tiny endpoint that answers "yes, I'm running".
// Monitoring tools (and n8n in Stage 6) call it to detect when the server is down.
import { Router } from 'express'

const router = Router()

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()), // how long the server has been running
    timestamp: new Date().toISOString(),
  })
})

export default router
