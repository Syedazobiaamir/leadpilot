import { formatDateTime, workflowRunSource } from '../../utils/formatters.js'

const STATUS_LABELS = {
  success: 'Success',
  retrying: 'Retrying',
  failed: 'Failed',
  escalated: 'Escalated to human',
}

const SOURCE_LABELS = {
  n8n: { text: 'n8n', title: 'A real run, reported by n8n' },
  backend: { text: 'Not delivered', title: 'The backend could not reach n8n, so this workflow never started' },
  sample: { text: 'Sample', title: 'SIMULATED sample data from an earlier stage' },
}

// Shows automation workflow runs and what happened when they failed.
// Each run says where it came from: a real n8n run, an event n8n never received, or sample data.
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
            <RunSource id={run.id} />
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

function RunSource({ id }) {
  const source = workflowRunSource(id)
  const { text, title } = SOURCE_LABELS[source]
  return (
    <span className={`badge run-source run-source-${source}`} title={title}>
      {text}
    </span>
  )
}
