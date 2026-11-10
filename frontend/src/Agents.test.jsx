// Stage 5 UI: review flags, follow-up drafts (approve / edit / reject) and real agent runs.
// Fake API only: no server, no real AI.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'
import { FAKE_DRAFT, installFakeApi } from './test/fakeApi.js'

afterEach(() => vi.unstubAllGlobals())

/** Renders the app, optionally changing the fake data first, and opens one lead. */
async function openLead(name, { ai = 'qualifies', n8n = 'off', setup } = {}) {
  const api = installFakeApi({ ai, n8n })
  setup?.(api.db)
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: 'Hot leads to call first' })
  await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Leads' }))
  await user.click(screen.getByRole('button', { name }))
  return { api, user, panel: () => screen.getByRole('region', { name: 'Follow-up' }) }
}

const flag = (db, id, flags) => {
  db.leads.find((l) => l.id === id).reviewFlags = flags
}
const draftFor = (leadId, changes = {}) => ({ ...FAKE_DRAFT, id: 'FU-1', leadId, createdAt: '2026-11-07T08:00:00.000Z', ...changes })

describe('review flags (Validation Agent)', () => {
  it('a blocked lead shows "Needs review" in the table and explains that the AI was skipped', async () => {
    await openLead('Michael Brown', { setup: (db) => flag(db, 'LD-1008', ['test_or_placeholder']) })
    const row = screen.getByRole('button', { name: 'Michael Brown' }).closest('tr')
    expect(within(row).getByText('Needs review')).toBeInTheDocument()

    const box = screen.getByRole('region', { name: 'Needs review' })
    expect(box).toHaveTextContent(/the AI was not used/)
    expect(within(box).getByText('Looks like a test or placeholder entry')).toBeInTheDocument()
    expect(within(box).getByText('AI skipped')).toBeInTheDocument()
  })

  it('a "review" flag explains that the AI still ran', async () => {
    await openLead('Michael Brown', { setup: (db) => flag(db, 'LD-1008', ['contains_link']) })
    const box = screen.getByRole('region', { name: 'Needs review' })
    expect(box).toHaveTextContent(/The AI still ran/)
    expect(within(box).getByText('Message contains a link')).toBeInTheDocument()
  })

  it('a lead without flags shows no review box', async () => {
    await openLead('Maria Gonzalez')
    expect(screen.queryByRole('region', { name: 'Needs review' })).not.toBeInTheDocument()
  })
})

describe('follow-up drafts', () => {
  it('no draft yet → "Draft follow-up with AI" → "writing…" → the draft appears, marked "not sent"', async () => {
    const { api, user, panel } = await openLead('Maria Gonzalez')
    expect(await within(panel()).findByText(/No follow-up yet/)).toBeInTheDocument()

    await user.click(within(panel()).getByRole('button', { name: 'Draft follow-up with AI' }))
    expect(api.fetchMock).toHaveBeenCalledWith('/api/leads/LD-1001/followups', expect.objectContaining({ method: 'POST' }))
    expect(await within(panel()).findByText('About your project', { exact: false })).toBeInTheDocument()
    expect(within(panel()).getByText(/AI draft · not sent · needs approval/)).toBeInTheDocument()
    expect(within(panel()).queryByRole('status')).not.toBeInTheDocument() // "writing…" is gone: waiting has stopped
    expect(within(panel()).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    // One open draft at a time: no "draft another" button while this one waits
    expect(within(panel()).queryByRole('button', { name: /Draft .*follow-up with AI/ })).not.toBeInTheDocument()
  })

  it('shows "the AI is writing" while waiting', async () => {
    const { api, user, panel } = await openLead('Maria Gonzalez')
    await within(panel()).findByText(/No follow-up yet/)
    api.db.pendingDrafts.add = () => {} // the draft never arrives in this test
    await user.click(within(panel()).getByRole('button', { name: 'Draft follow-up with AI' }))
    expect(await within(panel()).findByRole('status')).toHaveTextContent(/The AI is writing a draft/)
  })

  it('an existing draft (e.g. written automatically for a Hot lead) is shown right away', async () => {
    const { panel } = await openLead('Maria Gonzalez', { setup: (db) => db.followUps.push(draftFor('LD-1001')) })
    expect(await within(panel()).findByText(/Thank you for reaching out/)).toBeInTheDocument()
  })

  it('Approve with n8n running → "waiting for n8n", then "Sent … SIMULATED"; the buttons disappear', async () => {
    const { user, panel } = await openLead('Maria Gonzalez', { n8n: 'sends', setup: (db) => db.followUps.push(draftFor('LD-1001')) })
    await user.click(await within(panel()).findByRole('button', { name: 'Approve' }))
    expect(await within(panel()).findByText(/Approved · waiting for n8n to send it/)).toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()

    expect(await within(panel()).findByText(/Sent by n8n · SIMULATED: no real email reached the customer/)).toBeInTheDocument()
    expect(within(panel()).getByText(/sent .* \(simulated\)/)).toBeInTheDocument()
    expect(within(panel()).queryByRole('status')).not.toBeInTheDocument() // waiting has stopped
  })

  it('Approve with n8n off → stays "approved", and says so honestly after a while (never "sent")', async () => {
    const { user, panel } = await openLead('Maria Gonzalez', { setup: (db) => db.followUps.push(draftFor('LD-1001')) })
    await user.click(await within(panel()).findByRole('button', { name: 'Approve' }))
    expect(await within(panel()).findByRole('status')).toHaveTextContent(/Waiting for n8n to send it/)
    expect(await within(panel()).findByText(/n8n has not confirmed sending yet/)).toBeInTheDocument()
    expect(within(panel()).getByText(/Approved · waiting for n8n/)).toBeInTheDocument()
    expect(within(panel()).queryByText(/Sent by n8n/)).not.toBeInTheDocument()
  })

  it('Reject → "rejected"; a new draft can be requested', async () => {
    const { user, panel } = await openLead('Maria Gonzalez', { setup: (db) => db.followUps.push(draftFor('LD-1001')) })
    await user.click(await within(panel()).findByRole('button', { name: 'Reject' }))
    expect(await within(panel()).findByText(/Rejected · will not be sent/)).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Draft a new follow-up with AI' })).toBeInTheDocument()
  })

  it('Edit → change the text → Save: the draft is updated and still needs approval', async () => {
    const { user, panel } = await openLead('Maria Gonzalez', { setup: (db) => db.followUps.push(draftFor('LD-1001')) })
    await user.click(await within(panel()).findByRole('button', { name: 'Edit' }))
    const form = within(panel()).getByRole('form', { name: 'Edit follow-up' })
    await user.clear(within(form).getByLabelText('Subject'))
    await user.type(within(form).getByLabelText('Subject'), 'Your roof inspection')
    await user.click(within(form).getByRole('button', { name: 'Save draft' }))

    expect(await within(panel()).findByText('Your roof inspection', { exact: false })).toBeInTheDocument()
    expect(within(panel()).getByText(/needs approval/)).toBeInTheDocument()
    expect(within(panel()).getByText(/edited/)).toBeInTheDocument()
  })

  it('Edit with an invalid subject shows the server\'s message and keeps the form open', async () => {
    const { user, panel } = await openLead('Maria Gonzalez', { setup: (db) => db.followUps.push(draftFor('LD-1001')) })
    await user.click(await within(panel()).findByRole('button', { name: 'Edit' }))
    await user.clear(within(panel()).getByLabelText('Subject'))
    await user.type(within(panel()).getByLabelText('Subject'), 'Hi')
    await user.click(within(panel()).getByRole('button', { name: 'Save draft' }))
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('The edited follow-up is invalid')
    expect(within(panel()).getByRole('form', { name: 'Edit follow-up' })).toBeInTheDocument()
  })

  it('if someone else already approved it, the 409 message is shown (no silent overwrite)', async () => {
    const { api, user, panel } = await openLead('Maria Gonzalez', { setup: (db) => db.followUps.push(draftFor('LD-1001')) })
    await within(panel()).findByRole('button', { name: 'Reject' })
    api.db.followUps[0].status = 'approved' // changed elsewhere after the page loaded
    await user.click(within(panel()).getByRole('button', { name: 'Reject' }))
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('is already approved and can no longer be changed')
  })

  it('AI disabled → the server\'s message instead of a draft', async () => {
    const { user, panel } = await openLead('Maria Gonzalez', { ai: 'disabled' })
    await user.click(await within(panel()).findByRole('button', { name: 'Draft follow-up with AI' }))
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('AI is not configured on this server')
  })
})

describe('agent runs (Automation page and dashboard)', () => {
  const runs = [
    { runId: 'AR-1', leadId: 'LD-1013', agent: 'orchestrator', status: 'success', durationMs: 11785, errorKind: null, detail: 'validation: ok → qualification: Hot 95 → followup: draft FU-1', startedAt: '2026-11-07T08:21:00.000Z' },
    { runId: 'AR-2', leadId: 'LD-1014', agent: 'qualification', status: 'failed', durationMs: 900, errorKind: 'quota_exhausted', detail: "Gemini's daily quota is used up", startedAt: '2026-11-07T08:22:00.000Z' },
  ]

  it('the Automation page lists real agent runs, and says where each workflow run came from', async () => {
    const api = installFakeApi()
    api.db.agentRuns.push(...runs)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Hot leads to call first' })
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Automation' }))

    const list = screen.getByRole('list', { name: 'Agent runs' })
    expect(within(list).getByText('Orchestrator')).toBeInTheDocument()
    expect(within(list).getByText(/validation: ok → qualification: Hot 95/)).toBeInTheDocument()
    expect(within(list).getByText('Error: quota_exhausted')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Workflow runs' })).toBeInTheDocument()
    // The fixture runs are sample data: each one is labelled "Sample", none claims to be from n8n
    const runList = screen.getByRole('heading', { name: 'Workflow runs' }).closest('section')
    expect(within(runList).getAllByTitle('SIMULATED sample data from an earlier stage').length).toBe(api.db.workflowRuns.length)
    expect(within(runList).queryByTitle('A real run, reported by n8n')).not.toBeInTheDocument()
  })

  it('the dashboard shows recent agent runs, or says there are none yet', async () => {
    installFakeApi()
    render(<App />)
    expect(await screen.findByText(/No agent runs yet/)).toBeInTheDocument()
  })
})

describe('n8n automation on the Automation page (Stage 6)', () => {
  it('labels real n8n runs and undelivered events, and highlights escalations and hot-lead alerts', async () => {
    const api = installFakeApi()
    api.db.workflowRuns.push(
      { id: 'WF-n8n-17', workflow: 'Send approved follow-up', leadId: 'LD-1013', status: 'success', attempts: 1, maxAttempts: 3, lastError: null, startedAt: '2026-11-09T07:52:58.000Z' },
      { id: 'WF-be-1-1', workflow: 'Hot-lead alert', leadId: 'LD-1012', status: 'failed', attempts: 1, maxAttempts: 1, lastError: 'Event not delivered to n8n: Could not reach n8n', startedAt: '2026-11-09T07:50:00.000Z' },
    )
    api.db.activity.push(
      { id: 'EV-n8n-19', type: 'escalation', message: 'NEEDS A PERSON: Send approved follow-up failed at "Mark as sent": timeout', leadId: null, timestamp: '2026-11-09T07:53:55.000Z' },
      { id: 'EV-n8n-18', type: 'automation', message: 'HOT LEAD LD-1012: Linda, HVAC, timeline ASAP, score 95.', leadId: 'LD-1012', timestamp: '2026-11-09T07:53:28.000Z' },
    )
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Hot leads to call first' })
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Automation' }))

    const runs = screen.getByRole('heading', { name: 'Workflow runs' }).closest('section')
    expect(within(runs).getByText('Send approved follow-up').closest('li')).toHaveTextContent('n8n')
    expect(within(runs).getByText(/Event not delivered to n8n/).closest('li')).toHaveTextContent('Not delivered')

    expect(screen.getByText(/NEEDS A PERSON/).closest('li')).toHaveClass('activity-needs-person')
    expect(screen.getByText(/HOT LEAD LD-1012/).closest('li')).toHaveClass('activity-hot')
  })

  it('the banner says follow-up emails are SIMULATED', async () => {
    installFakeApi()
    render(<App />)
    expect(await screen.findByRole('note')).toHaveTextContent(/Follow-up emails are SIMULATED/)
  })
})
