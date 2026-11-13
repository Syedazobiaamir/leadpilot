// Stage 8: the operational report page. Fake API only.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'
import { installFakeApi } from './test/fakeApi.js'

afterEach(() => vi.unstubAllGlobals())

async function openReport(change) {
  const api = installFakeApi()
  change?.(api.db.report)
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: 'Hot leads to call first' })
  await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Report' }))
  await screen.findByRole('region', { name: 'Key numbers' })
  return { api, user }
}

describe('operational report', () => {
  it('shows the key numbers, plainly labelled', async () => {
    await openReport()
    const kpis = screen.getByRole('region', { name: 'Key numbers' })
    expect(within(kpis).getByText('New leads').closest('.stat-card')).toHaveTextContent('6')
    expect(within(kpis).getByText('Hot share').closest('.stat-card')).toHaveTextContent('62.5%')
    expect(within(kpis).getByText('Time to qualify').closest('.stat-card')).toHaveTextContent('< 1 min')
    expect(within(kpis).getByText('AI success').closest('.stat-card')).toHaveTextContent('75%')
    expect(within(kpis).getByText('Needs a person').closest('.stat-card')).toHaveTextContent('1')
    expect(screen.getByText(/includes 10 SIMULATED sample leads/)).toBeInTheDocument()
  })

  it('the AI quota meter says how much of the free daily limit is used', async () => {
    await openReport()
    const meter = screen.getByRole('meter', { name: 'AI requests today' })
    expect(meter).toHaveAttribute('aria-valuenow', '5')
    expect(meter).toHaveAttribute('aria-valuemax', '20')
    expect(meter).toHaveClass('meter-ok')
  })

  it('the meter warns when the quota is almost used up', async () => {
    await openReport((r) => (r.ai.requestsToday = 19))
    expect(screen.getByRole('meter', { name: 'AI requests today' })).toHaveClass('meter-danger')
    expect(screen.getByText(/Almost used up/)).toBeInTheDocument()
  })

  it('the leads-per-day chart has a table version for screen readers', async () => {
    await openReport()
    const table = screen.getByRole('table', { name: 'New leads per day' })
    expect(within(table).getAllByRole('row')).toHaveLength(8) // header + 7 days
    expect(within(table).getByText('2026-11-07').closest('tr')).toHaveTextContent('2')
  })

  it('nothing to measure yet → a dash, never "NaN"', async () => {
    await openReport((r) => {
      r.leads.hotShare = null
      r.ai.qualificationSuccessRate = null
      r.leads.medianMinutesToQualify = null
    })
    expect(document.body.textContent).not.toContain('NaN')
    expect(within(screen.getByText('Hot share').closest('.stat-card')).getByText('—')).toBeInTheDocument()
  })

  it('Refresh loads the report again', async () => {
    const { api, user } = await openReport()
    api.db.report.leads.lastPeriod = 7
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await within(screen.getByText('New leads').closest('.stat-card')).findByText('7')).toBeInTheDocument()
  })
})
