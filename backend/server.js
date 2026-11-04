// Entry point: creates the app and starts listening for HTTP requests.
import { createApp } from './app.js'
import { config } from './config.js'

const app = createApp()

const server = app.listen(config.port, () => {
  console.log(`API running on http://localhost:${config.port} (${config.env})`)
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
