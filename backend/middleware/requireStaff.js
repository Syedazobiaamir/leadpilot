// The LOCK on every staff-only route (Stage 8). Needs a valid "lp_session" cookie from POST /api/auth/login.
//   login not set up on the server → 503 AUTH_NOT_CONFIGURED (fail CLOSED: never open by accident)
//   no cookie, forged, expired, or from before a password change → 401 NOT_LOGGED_IN
// Public routes (the customer lead form, health checks) and n8n's /api/automation/* (own key) don't use it.
import { AppError } from '../utils/AppError.js'
import { auth, readCookie } from '../services/authService.js'

export function requireStaff(req, res, next) {
  const session = auth().check(readCookie(req)) // throws 503 if login isn't configured
  if (!session) throw new AppError(401, 'NOT_LOGGED_IN', 'Please log in.')
  req.staff = session
  next()
}
