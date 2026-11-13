// Vercel entry point (Stage 9): the whole Express backend as ONE serverless function.
//
// Locally, backend/server.js starts a server that listens on a port. On Vercel there is no
// long-running server: Vercel calls this function for each request (vercel.json sends every
// /api/... request here) and our Express app handles it exactly as it does locally.
// The frontend's built files are served by Vercel directly, without this function.

// Vercel runs deployments in production mode (HTTPS → Secure cookies, HSTS). Set it before the
// config is loaded, in case the platform didn't.
process.env.NODE_ENV ||= 'production'

// Load the app inside try/catch, like server.js: a configuration mistake (e.g. a missing setting
// in Vercel's Environment Variables) gives ONE clear log line and a clean 503, not a crash loop.
let app = null
let startupError = null
try {
  const { createApp } = await import('../backend/app.js')
  app = createApp()
} catch (err) {
  startupError = err
  // The message lists WHICH settings are wrong, never their values (see backend/config.js).
  console.error(JSON.stringify({ level: 'error', msg: 'cannot start the API', error: err.message }))
}

export default function handler(req, res) {
  if (startupError) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(
      JSON.stringify({
        error: { code: 'SERVER_MISCONFIGURED', message: 'The server is not configured correctly. The deployment logs say which setting is wrong.' },
      }),
    )
    return
  }
  return app(req, res)
}
