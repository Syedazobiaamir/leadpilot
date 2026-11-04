import StatCard from './StatCard.jsx'
import { computeLeadStats, computeWorkflowStats } from '../../utils/leadStats.js'
import { formatPercent } from '../../utils/formatters.js'

// The math lives in utils/leadStats.js. This component only displays the results.
export default function StatsOverview({ leads, workflowRuns }) {
  const leadStats = computeLeadStats(leads)
  const flowStats = computeWorkflowStats(workflowRuns)
  const needsAttention = flowStats.failed + flowStats.escalated

  return (
    <section className="stats-grid" aria-label="Key metrics">
      <StatCard label="Total leads" value={leadStats.total} hint={`${leadStats.pending} pending qualification`} />
      <StatCard label="Hot leads" value={leadStats.hot} tone="hot" hint="Ready to buy" />
      <StatCard label="Warm leads" value={leadStats.warm} tone="warm" hint="Nurture with follow-ups" />
      <StatCard label="Cold leads" value={leadStats.cold} tone="cold" hint="Long-term interest" />
      <StatCard label="Conversion rate" value={formatPercent(leadStats.conversionRate)} hint={`${leadStats.won} won`} />
      <StatCard
        label="Workflows needing attention"
        value={needsAttention}
        tone={needsAttention > 0 ? 'alert' : 'neutral'}
        hint={`${formatPercent(flowStats.successRate)} success rate`}
      />
    </section>
  )
}
