// Option A safeguard: the frontend and backend each have a copy of leadSchema.js.
// This test fails if the two copies ever differ, so nobody can update one and forget the other.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8').replace(/\r\n/g, '\n') // ignore Windows vs Unix line endings

describe('shared lead schema', () => {
  it('backend and frontend copies of leadSchema.js are identical', () => {
    const backendCopy = read('../validation/leadSchema.js')
    const frontendCopy = read('../../frontend/src/validation/leadSchema.js')
    expect(backendCopy, 'Copy your change to BOTH leadSchema.js files').toBe(frontendCopy)
  })
})
