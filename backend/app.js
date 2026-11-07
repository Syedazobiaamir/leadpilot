// Builds and configures the Express app, but does NOT start listening.
// Keeping this apart from server.js lets tests send requests to the app
// with Supertest, without opening a real network port.
import express from 'express'
import healthRoutes from './routes/health.routes.js'
import leadsRoutes from './routes/leads.routes.js'
import monitoringRoutes from './routes/monitoring.routes.js'
import followUpRoutes from './routes/followups.routes.js'
import { requestId } from './middleware/requestId.js'
import { requestLogger } from './middleware/requestLogger.js'
import { notFound } from './middleware/notFound.js'
import { errorHandler } from './middleware/errorHandler.js'

export function createApp() {
  const app = express()

  // Don't advertise "X-Powered-By: Express". It tells attackers what we run.
  app.disable('x-powered-by')

  // ORDER MATTERS: middleware runs top to bottom for each request.
  app.use(requestId) // 1. give the request an ID first, so everything after can use it
  app.use(requestLogger()) // 2. log the request when it finishes
  app.use(express.json({ limit: '10kb' })) // 3. parse JSON bodies (and block huge ones)

  // 4. Routes
  app.use('/api/health', healthRoutes)
  app.use('/api/leads', leadsRoutes)
  app.use('/api/followups', followUpRoutes)
  app.use('/api', monitoringRoutes) // /api/activity, /api/workflow-runs and /api/agent-runs

  // 5. Nothing matched: 404. Then turn every error into a clean JSON response.
  app.use(notFound)
  app.use(errorHandler())

  return app
}
