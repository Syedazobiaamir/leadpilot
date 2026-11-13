// URL → controller mapping for staff login (Stage 8). All PUBLIC (that's how you get in).
import { Router } from 'express'
import { login, logout, session } from '../controllers/auth.controller.js'
import { loginLimiter } from '../middleware/limiters.js'

const router = Router()

router.post('/login', loginLimiter, login) // POST /api/auth/login   { password }  (5 tries per 15 min per IP)
router.post('/logout', logout) //             POST /api/auth/logout
router.get('/session', session) //            GET  /api/auth/session  → { configured, loggedIn, expiresAt }

export default router
