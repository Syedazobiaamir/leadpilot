import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Express API (backend/) runs on this address during development.
const API_TARGET = 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Proxy: when the browser asks Vite for /api/..., Vite forwards the request to
  // Express. The browser only talks to localhost:5173, so there are no CORS problems.
  server: {
    proxy: { '/api': API_TARGET },
  },
  preview: {
    proxy: { '/api': API_TARGET },
  },
  // Vitest reads this "test" section.
  test: {
    environment: 'jsdom', // a fake browser so React components can render in Node
    globals: true, // lets us use describe / it / expect without importing them
    setupFiles: './src/test/setup.js',
  },
})
