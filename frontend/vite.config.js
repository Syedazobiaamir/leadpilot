import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vitest reads this "test" section.
  test: {
    environment: 'jsdom', // a fake browser so React components can render in Node
    globals: true, // lets us use describe / it / expect without importing them
    setupFiles: './src/test/setup.js',
  },
})
