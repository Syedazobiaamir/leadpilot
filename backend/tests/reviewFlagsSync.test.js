// The frontend shows labels for the Validation Agent's flags (frontend/src/utils/reviewFlags.js).
// This test fails if the backend and frontend lists ever differ, so a new flag can't be
// added on one side and forgotten on the other (same idea as schemaSync.test.js).
import { describe, expect, it } from 'vitest'
import { REVIEW_FLAGS } from '../agents/validationAgent.js'
import { REVIEW_FLAG_INFO } from '../../frontend/src/utils/reviewFlags.js'

describe('review flags: backend and frontend agree', () => {
  it('same flag codes', () => {
    expect(Object.keys(REVIEW_FLAG_INFO).sort()).toEqual(Object.keys(REVIEW_FLAGS).sort())
  })

  it('same severity for every flag (block = the AI is skipped)', () => {
    for (const [code, flag] of Object.entries(REVIEW_FLAGS)) {
      expect(REVIEW_FLAG_INFO[code]?.severity, code).toBe(flag.severity)
    }
  })
})
