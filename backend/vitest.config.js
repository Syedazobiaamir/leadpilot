// Vitest settings for the backend (Stage 8: a setup file logs every test in as staff).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.js'],
  },
})
