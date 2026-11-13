// Runs before every backend test file (vitest.config.js → setupFiles).
// Stage 8: every supertest request carries a real staff session cookie, unless a test removes it
// (asVisitor) to check that the route is locked. See tests/staffSession.js.
import { beforeEach, vi } from 'vitest'
import { installTestStaff } from './staffSession.js'

const state = vi.hoisted(() => ({ cookie: '' }))

vi.mock('supertest', async (importOriginal) => {
  const real = (await importOriginal()).default
  const withSession = (app) => {
    const agent = real(app)
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const original = agent[method].bind(agent)
      agent[method] = (url) => {
        const test = original(url)
        return state.cookie ? test.set('Cookie', state.cookie) : test
      }
    }
    return agent
  }
  return { default: withSession }
})

beforeEach(() => {
  state.cookie = installTestStaff()
})
