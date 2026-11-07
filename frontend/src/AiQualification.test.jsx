// AI qualification in the UI (Stage 4): labels, the "Qualify with AI" / "Retry AI" button,
// the "analyzing" state and automatic refresh. Uses the fake API: no server, no real AI.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'
import { FAKE_AI_RESULT, installFakeApi } from './test/fakeApi.js'
import { requalifyLead } from './services/leadService.js'
import LeadBadge from './components/leads/LeadBadge.jsx'
import AiQualification from './components/leads/AiQualification.jsx'

afterEach(() => vi.unstubAllGlobals())

async function openLead(name, ai) {
  const api = installFakeApi({ ai })
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: 'Hot leads to call first' })
  await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Leads' }))
  await user.click(screen.getByRole('button', { name }))
  return { api, user, box: () => screen.getByRole('region', { name: 'AI qualification' }) }
}

describe('lead detail: AI qualification', () => {
  it('a sample lead is clearly labelled "Simulated", with its reason and a "Qualify with AI" button', async () => {
    const { box } = await openLead('Maria Gonzalez', 'qualifies')
    expect(within(box()).getByText('Simulated')).toBeInTheDocument()
    expect(within(box()).getByText(/not a real AI result/)).toBeInTheDocument()
    expect(within(box()).getByText(/Simulated: active roof leak/)).toBeInTheDocument()
    expect(within(box()).getByRole('button', { name: 'Qualify with AI' })).toBeInTheDocument()
  })

  it('"Qualify with AI" → POST, "analyzing", then the real AI result appears by itself', async () => {
    const { api, user, box } = await openLead('Ashley Williams', 'qualifies')
    await user.click(within(box()).getByRole('button', { name: 'Qualify with AI' }))

    expect(api.fetchMock).toHaveBeenCalledWith('/api/leads/LD-1005/qualify', expect.objectContaining({ method: 'POST' }))
    // Automatic refresh (polling) brings the result without any click
    expect(await within(box()).findByText(FAKE_AI_RESULT.aiModel, { exact: false })).toBeInTheDocument()
    expect(within(box()).getByText('Gemini AI')).toBeInTheDocument()
    expect(within(box()).getByText(`“${FAKE_AI_RESULT.aiReason}”`)).toBeInTheDocument()
    expect(within(box()).queryByText('Simulated')).not.toBeInTheDocument()
    expect(within(box()).getByRole('button', { name: 'Re-run AI' })).toBeInTheDocument()
  })

  it('shows "analyzing" while the AI works (and hides the button)', async () => {
    const { api, user, box } = await openLead('Ashley Williams', 'qualifies')
    api.db.pendingAi.add = () => {} // keep the job "running": the result never arrives in this test
    await user.click(within(box()).getByRole('button', { name: 'Qualify with AI' }))
    expect(await within(box()).findByRole('status')).toHaveTextContent(/AI is analyzing this inquiry/)
    expect(within(box()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('when AI is off on the server, shows the server\'s message and changes nothing', async () => {
    const { user, box } = await openLead('Maria Gonzalez', 'disabled')
    await user.click(within(box()).getByRole('button', { name: 'Qualify with AI' }))
    expect(await within(box()).findByRole('alert')).toHaveTextContent('AI qualification is not configured on this server.')
    expect(within(box()).getByText('Simulated')).toBeInTheDocument()
  })

  it('a failed RE-run still shows the previous result and its source, with a clear note', async () => {
    const { user, box } = await openLead('Maria Gonzalez', 'fails')
    await user.click(within(box()).getByRole('button', { name: 'Qualify with AI' }))
    expect(await within(box()).findByText(/The latest AI run failed\. The previous result below is kept/)).toBeInTheDocument()
    expect(within(box()).getByText('Simulated')).toBeInTheDocument()
    expect(within(box()).getByText(/Simulated: active roof leak/)).toBeInTheDocument()
    expect(within(box()).getByRole('button', { name: 'Retry AI' })).toBeInTheDocument()
  })

  it('a lead that NEVER had a result shows the plain failure message and no result block', () => {
    const lead = { id: 'LD-2000', classification: null, score: null, qualificationStatus: 'failed', aiModel: null, aiReason: null }
    render(<AiQualification lead={lead} onRequalify={async () => ({ success: true })} />)
    expect(screen.getByText(/AI qualification failed\. The lead is saved/)).toBeInTheDocument()
    expect(screen.queryByText('Gemini AI')).not.toBeInTheDocument()
    expect(screen.queryByText('Simulated')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry AI' })).toBeInTheDocument()
  })

  it('a failed re-run of a classified lead keeps its class in the table and offers "Retry AI"', async () => {
    const { user, box } = await openLead('Ashley Williams', 'fails')
    await user.click(within(box()).getByRole('button', { name: 'Qualify with AI' }))

    expect(await within(box()).findByText(/The latest AI run failed\. The previous result below is kept/)).toBeInTheDocument()
    expect(within(box()).getByRole('button', { name: 'Retry AI' })).toBeInTheDocument()
    const row = screen.getByRole('button', { name: 'Ashley Williams' }).closest('tr')
    // The old (simulated) class is kept: a failed re-run never throws data away
    expect(within(row).getByText('Cold')).toBeInTheDocument()
  })
})

describe('new lead: AI result arrives automatically', () => {
  it('saved as Pending, then shows the AI classification without a page refresh', async () => {
    installFakeApi({ ai: 'qualifies' })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Hot leads to call first' })
    const nav = within(screen.getByRole('navigation', { name: 'Main' }))
    await user.click(nav.getByRole('button', { name: 'New Lead' }))

    await user.type(screen.getByLabelText('Full name'), 'Tom Rivera')
    await user.type(screen.getByLabelText('Phone'), '512-555-0199')
    await user.type(screen.getByLabelText('Email'), 'tom.rivera@example.com')
    await user.type(screen.getByLabelText('ZIP code'), '78702')
    await user.selectOptions(screen.getByLabelText('Service needed'), 'Plumbing')
    await user.selectOptions(screen.getByLabelText('Timeline'), 'ASAP')
    await user.type(screen.getByLabelText('Project details'), 'Water heater burst, water everywhere.')
    await user.click(screen.getByRole('button', { name: 'Save lead' }))
    await screen.findByText(/saved for Tom Rivera/)

    await user.click(nav.getByRole('button', { name: 'Leads' }))
    const row = () => screen.getByRole('button', { name: 'Tom Rivera' }).closest('tr')
    expect(await within(row()).findByText('Hot')).toBeInTheDocument()
    expect(within(row()).getByText(String(FAKE_AI_RESULT.score))).toBeInTheDocument()
  })
})

describe('polling stops (no endless requests)', () => {
  const leadGets = (api) => api.fetchMock.mock.calls.filter(([url, init]) => url === '/api/leads' && (init?.method ?? 'GET') === 'GET').length
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  it('stops once the AI result has arrived', async () => {
    const { api, user, box } = await openLead('Ashley Williams', 'qualifies')
    await user.click(within(box()).getByRole('button', { name: 'Qualify with AI' }))
    await within(box()).findByText('Gemini AI')
    await pause(100) // let any already-scheduled poll finish
    const after = leadGets(api)
    await pause(300) // 10 poll intervals
    expect(leadGets(api)).toBe(after)
  })

  it('gives up after the watch time when the lead stays pending (e.g. AI off)', async () => {
    const { api, user, box } = await openLead('Ashley Williams', 'qualifies')
    api.db.pendingAi.add = () => {} // the AI never finishes
    await user.click(within(box()).getByRole('button', { name: 'Qualify with AI' }))
    await pause(600) // longer than QUALIFICATION_WATCH_MS in tests (300 ms)
    const after = leadGets(api)
    await pause(300)
    expect(leadGets(api)).toBe(after)
    expect(after).toBeGreaterThan(2) // it did poll while waiting
  })
})

describe('requalifyLead (service)', () => {
  it('returns the pending lead on 202', async () => {
    installFakeApi({ ai: 'qualifies' })
    const result = await requalifyLead('LD-1001')
    expect(result).toMatchObject({ success: true, lead: { id: 'LD-1001', qualificationStatus: 'pending' } })
  })

  it('returns the error code and message instead of throwing', async () => {
    installFakeApi({ ai: 'disabled' })
    expect(await requalifyLead('LD-1001')).toEqual({ success: false, code: 'AI_UNAVAILABLE', error: 'AI qualification is not configured on this server.' })
  })

  it('reports a network failure honestly', async () => {
    installFakeApi({ failWith: 'network' })
    expect(await requalifyLead('LD-1001')).toMatchObject({ success: false, code: 'NETWORK_ERROR' })
  })
})

describe('LeadBadge', () => {
  it.each([
    [{ classification: 'Hot', qualificationStatus: 'qualified' }, 'Hot'],
    [{ classification: null, qualificationStatus: 'pending' }, 'Pending'],
    [{ classification: null, qualificationStatus: 'failed' }, 'AI failed'],
    [{ classification: null }, 'Pending'],
  ])('%o → "%s"', (props, text) => {
    render(<LeadBadge {...props} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})
