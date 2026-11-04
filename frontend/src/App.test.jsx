// Component tests: render the real app in a fake browser (jsdom) and use it
// the way a person would, by clicking and typing.
// The backend is replaced by a fake API (src/test/fakeApi.js), so no server is needed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'
import { installFakeApi } from './test/fakeApi.js'

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  // Wait until the data has loaded.
  await screen.findByRole('heading', { name: 'Hot leads to call first' })
  return user
}

async function goTo(user, label) {
  await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: label }))
}

describe('App', () => {
  let api
  beforeEach(() => {
    api = installFakeApi() // fresh sample data for every test
  })
  afterEach(() => vi.unstubAllGlobals())

  it('always shows the simulated data banner', async () => {
    await renderApp()
    expect(screen.getByRole('note')).toHaveTextContent(/simulated sample data/i)
  })

  it('shows dashboard metrics from the sample data', async () => {
    await renderApp()
    const metrics = screen.getByRole('region', { name: 'Key metrics' })
    expect(within(metrics).getByText('Total leads').nextSibling).toHaveTextContent('10')
    expect(within(metrics).getByText('Hot leads').nextSibling).toHaveTextContent('4')
  })

  it('shows field errors when an empty lead form is submitted', async () => {
    const user = await renderApp()
    await goTo(user, 'New Lead')
    await user.click(screen.getByRole('button', { name: 'Save lead' }))

    expect(screen.getByText('Name must be at least 2 characters')).toBeInTheDocument()
    expect(screen.getByText(/valid US phone/)).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('saves a valid lead and shows it in the leads table as Pending', async () => {
    const user = await renderApp()
    await goTo(user, 'New Lead')

    await user.type(screen.getByLabelText('Full name'), 'Tom Rivera')
    await user.type(screen.getByLabelText('Phone'), '512-555-0199')
    await user.type(screen.getByLabelText('Email'), 'tom.rivera@example.com')
    await user.type(screen.getByLabelText('ZIP code'), '78702')
    await user.selectOptions(screen.getByLabelText('Service needed'), 'Siding')
    await user.selectOptions(screen.getByLabelText('Timeline'), 'Within 1 month')
    await user.type(screen.getByLabelText('Project details'), 'Need new siding on a two-story house.')
    await user.click(screen.getByRole('button', { name: 'Save lead' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/Lead LD-\d+ saved for Tom Rivera/)
    // The lead really went to the API with a POST
    expect(api.fetchMock).toHaveBeenCalledWith('/api/leads', expect.objectContaining({ method: 'POST' }))

    await goTo(user, 'Leads')
    const row = screen.getByRole('button', { name: 'Tom Rivera' }).closest('tr')
    expect(within(row).getByText('Pending')).toBeInTheDocument()
  })

  it('shows the duplicate error from the server under the form', async () => {
    const user = await renderApp()
    await goTo(user, 'New Lead')

    await user.type(screen.getByLabelText('Full name'), 'Maria G')
    await user.type(screen.getByLabelText('Phone'), '512-555-0100')
    await user.type(screen.getByLabelText('Email'), 'maria.gonzalez@example.com') // already exists
    await user.type(screen.getByLabelText('ZIP code'), '78701')
    await user.selectOptions(screen.getByLabelText('Service needed'), 'Roofing')
    await user.selectOptions(screen.getByLabelText('Timeline'), 'ASAP')
    await user.type(screen.getByLabelText('Project details'), 'Second request about the roof.')
    await user.click(screen.getByRole('button', { name: 'Save lead' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/)
    expect(screen.queryByText(/saved for/)).not.toBeInTheDocument()
  })

  it('shows an honest error with a retry button when the server is down', async () => {
    vi.unstubAllGlobals()
    installFakeApi({ failWith: 'network' })
    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Could not reach the server/)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // It must NOT look like an empty dashboard
    expect(screen.queryByRole('region', { name: 'Key metrics' })).not.toBeInTheDocument()
  })

  it('filters the leads table to Hot leads only', async () => {
    const user = await renderApp()
    await goTo(user, 'Leads')
    await user.selectOptions(screen.getByLabelText('Classification'), 'Hot')

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1) // skip the header row
    expect(rows).toHaveLength(4)
    rows.forEach((row) => expect(within(row).getByText('Hot')).toBeInTheDocument())
    expect(screen.getByText('Showing 4 of 10 leads')).toBeInTheDocument()
  })

  it('opens lead details when a customer name is clicked', async () => {
    const user = await renderApp()
    await goTo(user, 'Leads')
    await user.click(screen.getByRole('button', { name: 'Maria Gonzalez' }))

    const detail = screen.getByRole('region', { name: 'Maria Gonzalez' })
    expect(within(detail).getByText('maria.gonzalez@example.com')).toBeInTheDocument()
    expect(within(detail).getByText(/Hail storm/)).toBeInTheDocument()
  })
})
