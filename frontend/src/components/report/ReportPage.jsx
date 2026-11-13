import StatCard from '../dashboard/StatCard.jsx'
import { formatDateTime, formatPercent } from '../../utils/formatters.js'

// Operational report (Stage 8, core feature #12). Numbers come from GET /api/reports/overview.
// Never shows customer data: only counts.
const dash = '—' // shown when there is nothing to measure yet

function dayLabel(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** One bar per day, one hue (a single series needs no legend). Hover/focus shows the number. */
function LeadsPerDay({ days }) {
  const max = Math.max(1, ...days.map((d) => d.count))
  return (
    <figure className="day-chart">
      <div className="day-bars" aria-hidden="true">
        {days.map((d) => (
          <div key={d.date} className="day-column">
            <div className="day-plot">
              <div className="day-bar" style={{ height: `${(d.count / max) * 100}%` }} tabIndex={0} title={`${dayLabel(d.date)}: ${d.count} lead${d.count === 1 ? '' : 's'}`}>
                <span className="day-tip">{d.count}</span>
              </div>
            </div>
            <span className="day-name">{dayLabel(d.date)}</span>
          </div>
        ))}
      </div>
      {/* The same numbers as a table, for screen readers (the bars above are hidden from them). */}
      <table className="visually-hidden">
        <caption>New leads per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Leads</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** "N of 20 AI requests today": the fill turns warning/danger as the free quota runs out. */
function QuotaMeter({ used, limit, resetsAt }) {
  const ratio = Math.min(1, used / limit)
  const level = ratio >= 0.9 ? 'danger' : ratio >= 0.7 ? 'warning' : 'ok'
  return (
    <div className="quota">
      <div className="quota-head">
        <span>AI requests today</span>
        <strong>
          {used} of {limit}
        </strong>
      </div>
      <div className={`meter meter-${level}`} role="meter" aria-label="AI requests today" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
        <div className="meter-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="muted small">
        {level === 'danger' ? 'Almost used up. ' : level === 'warning' ? 'Running low. ' : ''}
        Free tier limit; resets {formatDateTime(resetsAt)}. Estimate: AI checks and evals run by hand are not counted.
      </p>
    </div>
  )
}

function Counts({ label, rows }) {
  return (
    <section className="card">
      <h2>{label}</h2>
      <dl className="count-list">
        {rows.map(([name, value, tone]) => (
          <div key={name} className={tone ? `count-${tone}` : undefined}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default function ReportPage({ report, loading, error, onRefresh }) {
  if (loading && !report) return <p className="muted">Loading the report…</p>
  if (error && !report) {
    return (
      <div className="card error-state" role="alert">
        <p>Could not load the report: {error}</p>
        <button type="button" className="button-primary" onClick={onRefresh}>
          Try again
        </button>
      </div>
    )
  }
  const { leads, ai, followUps, automation, selfHealing } = report
  const minutes = leads.medianMinutesToQualify

  return (
    <>
      <div className="report-toolbar">
        <p className="muted small">
          Last {report.period.days} days · generated {formatDateTime(report.generatedAt)}
          {leads.simulated > 0 && ` · includes ${leads.simulated} SIMULATED sample lead${leads.simulated === 1 ? '' : 's'} (never counted as AI results)`}
        </p>
        <button type="button" className="button-secondary" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <section className="stats-grid" aria-label="Key numbers">
        <StatCard label="New leads" value={leads.lastPeriod} hint={`${leads.total} in total`} />
        <StatCard label="Hot share" value={leads.hotShare === null ? dash : formatPercent(leads.hotShare)} hint={`${leads.byClass.Hot} Hot · ${leads.byClass.Warm} Warm · ${leads.byClass.Cold} Cold`} tone="hot" />
        <StatCard label="Time to qualify" value={minutes === null ? dash : minutes < 1 ? '< 1 min' : `${minutes} min`} hint="Form sent → AI answer (median, automatic only)" />
        <StatCard label="AI success" value={ai.qualificationSuccessRate === null ? dash : formatPercent(ai.qualificationSuccessRate)} hint={`${ai.qualificationRuns} qualification runs`} />
        <StatCard label="Needs a person" value={selfHealing.needsPerson} hint="Problems the system could not fix" tone={selfHealing.needsPerson > 0 ? 'alert' : 'neutral'} />
      </section>

      <div className="two-col">
        <section className="card">
          <h2>New leads per day</h2>
          <LeadsPerDay days={leads.perDay} />
        </section>
        <section className="card">
          <h2>AI</h2>
          <QuotaMeter used={ai.requestsToday} limit={ai.dailyLimit} resetsAt={ai.quotaResetsAt} />
          <dl className="count-list">
            <div>
              <dt>AI calls (7 days)</dt>
              <dd>{ai.runs}</dd>
            </div>
            <div>
              <dt>Average answer time</dt>
              <dd>{ai.avgSeconds === null ? dash : `${ai.avgSeconds} s`}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>
                {ai.failed}
                {ai.failed > 0 && ` (${Object.entries(ai.failureKinds).map(([kind, n]) => `${kind} ${n}`).join(', ')})`}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="three-col">
        <Counts
          label="Follow-up emails"
          rows={[['Waiting for approval', followUps.waitingForApproval], ['Being sent', followUps.inProgress], ['Sent (SIMULATED)', followUps.sent], ['Rejected', followUps.rejected]]}
        />
        <Counts
          label="Automation (n8n, 7 days)"
          rows={[['Runs', automation.runs], ['Succeeded', automation.success], ['Failed', automation.failed, automation.failed > 0 ? 'danger' : null], ['Escalated', automation.escalated, automation.escalated > 0 ? 'danger' : null]]}
        />
        <Counts
          label="Self-healing"
          rows={[['Retrying', selfHealing.retrying], ['Recovered', selfHealing.recovered], ['Needs a person', selfHealing.needsPerson, selfHealing.needsPerson > 0 ? 'danger' : null]]}
        />
      </div>
      <p className="muted small">
        Leads needing review: {leads.needsReview} · blocked as test/spam: {leads.blocked}. Figures are counts only; no customer details are shown here.
      </p>
    </>
  )
}
