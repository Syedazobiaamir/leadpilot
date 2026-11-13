// Stage 8: tests are LOGGED IN as staff by default, through the real login (no bypass in the app).
//
// setup.js (runs before every test file) sets a test password, logs in with it, and makes every
// supertest request send the session cookie. A test that must act as a visitor WITHOUT a login
// sends `.set('Cookie', '')` (see asVisitor below), which replaces the default cookie.
import { createAuthService, hashPassword, useAuthForTests, COOKIE_NAME } from '../services/authService.js'

export const TEST_PASSWORD = 'correct horse battery staple' // test-only, never a real password
export const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef-0123'

// Low scrypt cost: fast tests. Production hashes use the default (16384).
export const TEST_PASSWORD_HASH = hashPassword(TEST_PASSWORD, { N: 1024 })

/** Installs the test login and returns the "Cookie" header value of a fresh staff session. */
export function installTestStaff() {
  useAuthForTests({ passwordHash: TEST_PASSWORD_HASH, sessionSecret: TEST_SESSION_SECRET })
  const { token } = createAuthService({ passwordHash: TEST_PASSWORD_HASH, sessionSecret: TEST_SESSION_SECRET }).login(TEST_PASSWORD)
  return `${COOKIE_NAME}=${token}`
}

/** Makes a supertest request act as an anonymous visitor (no session cookie). */
export const asVisitor = (req) => req.set('Cookie', '')
