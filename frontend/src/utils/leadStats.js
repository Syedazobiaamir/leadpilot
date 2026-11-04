// Business calculations for the dashboard. These are kept out of the React
// components so they can be tested on their own and reused by the backend later.

/** Counts leads by classification and status. */
export function computeLeadStats(leads) {
  const stats = { total: leads.length, hot: 0, warm: 0, cold: 0, pending: 0, won: 0 }

  for (const lead of leads) {
    if (lead.classification === 'Hot') stats.hot++
    else if (lead.classification === 'Warm') stats.warm++
    else if (lead.classification === 'Cold') stats.cold++
    else stats.pending++ // no classification yet means AI qualification is pending

    if (lead.status === 'Won') stats.won++
  }

  // Conversion rate = won leads / all leads. Avoid dividing by zero.
  stats.conversionRate = stats.total === 0 ? 0 : stats.won / stats.total
  return stats
}

/** Summarizes automation workflow runs for the monitoring panel. */
export function computeWorkflowStats(runs) {
  const stats = { total: runs.length, success: 0, retrying: 0, failed: 0, escalated: 0 }

  for (const run of runs) {
    if (run.status in stats) stats[run.status]++
  }

  stats.successRate = stats.total === 0 ? 0 : stats.success / stats.total
  return stats
}

/**
 * Filters leads by classification, status and a search term.
 * 'All' (or an empty value) means "don't filter on this".
 */
export function filterLeads(leads, { classification = 'All', status = 'All', search = '' } = {}) {
  const term = search.trim().toLowerCase()

  return leads.filter((lead) => {
    if (classification !== 'All') {
      const leadClass = lead.classification ?? 'Pending'
      if (leadClass !== classification) return false
    }
    if (status !== 'All' && lead.status !== status) return false
    if (term) {
      const haystack = `${lead.name} ${lead.email} ${lead.serviceType} ${lead.zip}`.toLowerCase()
      if (!haystack.includes(term)) return false
    }
    return true
  })
}
