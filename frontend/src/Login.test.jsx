// Stage 8: the login gate. Fake API only (no server).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'
import { FAKE_STAFF_PASSWORD, installFakeApi } from './test/fakeApi.js'

afterEach(() => vi.unstubAllGlobals())

const requestedPaths = (api) => api.fetchMock.mock.calls.map(([url]) => String(url))

async function startLoggedOut(session = {}) {
  const api = installFakeApi({ session: { loggedIn: false, ...session } })
  const user = userEvent.setup()
  render(<App />)
  return { api, user }
}

describe('login gate', () => {
  it('logged out → the login page, and NO customer data is even requested', async () => {
    const { api } = await startLoggedOut()
    expect(await screen.findByRole('form', { name: 'Staff login' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(requestedPaths(api)).toEqual(['/api/auth/session'])
  })

  it('an empty password is not even sent', async () => {
    const { api, user } = await startLoggedOut()
    await user.click(await screen.findByRole('button', { name: 'Log in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the staff password.')
    expect(requestedPaths(api)).not.toContain('/api/auth/login')
  })

  it('a wrong password → the server\'s message, the field is cleared, still on the login page', async () => {
    const { user } = await startLoggedOut()
    await user.type(await screen.findByLabelText('Password'), 'wrong guess')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password.')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
  })

  it('the right password → the dashboard', async () => {
    const { user } = await startLoggedOut()
    await user.type(await screen.findByLabelText('Password'), FAKE_STAFF_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('heading', { name: 'Hot leads to call first' })).toBeInTheDocument()
  })

  it('Log out → back to the login page', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Hot leads to call first' })
    await user.click(screen.getByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('form', { name: 'Staff login' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('You are logged out.')
  })

  it('the session ends while working (e.g. after 8 hours) → back to login, saying why', async () => {
    const api = installFakeApi({ ai: 'qualifies' })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Hot leads to call first' })
    api.db.session.loggedIn = false // the server forgot us
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Leads' }))
    await user.click(screen.getByRole('button', { name: 'Maria Gonzalez' })) // loads her follow-ups → 401
    expect(await screen.findByRole('form', { name: 'Staff login' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Please log in again.')
  })

  it('login not set up on the server → says how to set it up (no password field)', async () => {
    await startLoggedOut({ configured: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('npm run auth:set-password')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })
})

describe('stored data is shown as text, never run (XSS)', () => {
  it('HTML/script in a customer message appears as plain text, and no element is created from it', async () => {
    const attack = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script> Roof leak'
    const api = installFakeApi()
    api.db.leads.find((l) => l.id === 'LD-1001').message = attack
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Hot leads to call first' })
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Leads' }))
    await user.click(screen.getByRole('button', { name: 'Maria Gonzalez' }))
    expect(await screen.findByText(attack)).toBeInTheDocument() // the exact text, visible as text
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
    expect(window.__pwned).toBeUndefined()
  })
})
