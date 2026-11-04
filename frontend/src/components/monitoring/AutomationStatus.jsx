import { formatDateTime } from '../../utils/formatters.js'

const STATUS_LABELS = {
  success: 'Success',
  retrying: 'Retrying',
  failed: 'Failed',
  escalated: 'Escalated to human',
}

// Shows automation workflow runs and what happened when they failed.
// limit: show only the newest N runs (used on the dashboard).
export default function AutomationStatus({ runs, limit }) {
  const visible = limit ? runs.slice(0, limit) : runs

  if (visible.length === 0) {
    return <p className="empty-state">No workflow runs yet.</p>
  }

  return (
    <ul className="run-list">
      {visible.map((run) => (
        <li key={run.id} className={`run run-${run.status}`}>
          <div className="run-main">
            <span className={`status-pill status-${run.status}`}>{STATUS_LABELS[run.status] ?? run.status}</span>
            <span className="run-name">{run.workflow}</span>
          </div>
          <div className="run-meta muted">
            {run.id}
            {run.leadId && ` · ${run.leadId}`} · attempt {run.attempts}/{run.maxAttempts} ·{' '}
            {formatDateTime(run.startedAt)}
          </div>
          {run.lastError && <p className="run-error">Last error: {run.lastError}</p>}
        </li>
      ))}
    </ul>
  )
}
