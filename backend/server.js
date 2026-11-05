// Entry point: creates the app and starts listening for HTTP requests.

// Load config and the app with import() inside try/catch: a configuration mistake
// (e.g. a missing GOOGLE_* setting) then prints ONE clear message instead of a long stack trace.
let config, createApp, pingStore, storeName
try {
  ;({ config } = await import('./config.js'))
  ;({ createApp } = await import('./app.js'))
  ;({ pingStore, storeName } = await import('./services/leadStore.js'))
} catch (err) {
  console.error(`\nCannot start the server.\n${err.message}\n`)
  process.exit(1)
}

const app = createApp()

const server = app.listen(config.port, async () => {
  console.log(`API running on http://localhost:${config.port} (${config.env}, store: ${storeName})`)

  // For Google Sheets, check the connection once at startup so setup problems show
  // up immediately, not on the first customer's lead. The server keeps running either way:
  // GET /api/health/ready reports the current state, and the logs say what's wrong.
  if (storeName === 'sheets') {
    try {
      await pingStore()
      console.log('Google Sheets connection OK')
    } catch {
      console.error('Google Sheets is NOT ready. See the "storage error" log line above. Run "npm run sheets:check" for help.')
    }
  }
})

// A clear message if the port is already in use (for example, the server is already running elsewhere).
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Stop the other process or change PORT in .env.`)
  } else {
    console.error('Server failed to start:', err.message)
  }
  process.exit(1)
})
