// Stage 9: the PUBLIC customer form page (/request). Fake API only (no server).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RequestPage from './components/public/RequestPage.jsx'
import { installFakeApi } from './test/fakeApi.js'

afterEach(() => vi.unstubAllGlobals())

const requestedPaths = (api) => api.fetchMock.mock.calls.map(([url]) => String(url))

// A visitor, NOT logged in: the page must work without any staff session.
function start(options = {}) {
  const api = installFakeApi({ session: { loggedIn: false }, ...options })
  const user = userEvent.setup()
  render(<RequestPage />)
  return { api, user }
}

async function fillValid(user, { email = 'dana.price@example.com' } = {}) {
  await user.type(screen.getByLabelText('Full name'), 'Dana Price')
  await user.type(screen.getByLabelText('Phone'), '512-555-0188')
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('ZIP code'), '78704')
  await user.selectOptions(screen.getByLabelText('Service needed'), 'Roofing')
  await user.selectOptions(screen.getByLabelText('Timeline'), 'Within 1 month')
  await user.type(screen.getByLabelText('Project details'), 'Some shingles blew off in the storm last week.')
}

describe('public request page', () => {
  it('shows the form and requests NOTHING on load (no customer data, no staff session)', () => {
    const { api } = start()
    expect(screen.getByRole('heading', { name: 'Request a free estimate' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Request an estimate' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(requestedPaths(api)).toEqual([])
  })

  it('a visitor can send a request: POST /api/leads with an Idempotency-Key, then a thank-you with the first name', async () => {
    const { api, user } = start()
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: 'Send request' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Thank you, Dana! We received your request')
    expect(requestedPaths(api)).toEqual(['/api/leads'])
    expect(api.db.idempotencyKeys).toHaveLength(1)
    expect(api.db.idempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/)
    // The customer never sees internal details (lead ID, AI status).
    expect(screen.getByRole('status')).not.toHaveTextContent(/LD-\d+|AI|simulated/i)
  })

  it('invalid input → field errors from the shared schema, nothing sent', async () => {
    const { api, user } = start()
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true')
    expect(document.getElementById('lead-name-error')).not.toBeNull()
    expect(requestedPaths(api)).toEqual([])
  })

  it('a duplicate request gets a friendly sentence, not the staff wording', async () => {
    const { api, user } = start()
    const known = api.db.leads[0].email
    await fillValid(user, { email: known })
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We already have a request with this email or phone number')
  })

  it('server unreachable → a customer-friendly message (no "backend" talk), and never a fake success', async () => {
    const { user } = start({ failWith: 'network' })
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sorry, we could not send your request right now')
    expect(alert).not.toHaveTextContent(/backend/i)
    expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument()
  })
})
