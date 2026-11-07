import { formatDateTime } from '../../utils/formatters.js'

const AGENT_NAMES = {
  orchestrator: 'Orchestrator',
  validation: 'Validation Agent',
  qualification: 'Qualification Agent',
  followup: 'Follow-up Agent',
}

// The REAL record of what each AI agent did (Stage 5), from AgentRuns.
// limit: show only the newest N runs (used on the dashboard).
export default function AgentRuns({ runs, limit }) {
  const visible = limit ? runs.slice(0, limit) : runs

  if (visible.length === 0) {
    return <p className="empty-state">No agent runs yet. They appear here when a new lead arrives.</p>
  }

  return (
    <ul className="run-list" aria-label="Agent runs">
      {visible.map((run) => (
        <li key={run.runId} className={`run run-${run.status}`}>
          <div className="run-main">
            <span className={`status-pill agent-status-${run.status}`}>{run.status}</span>
            <span className="run-name">{AGENT_NAMES[run.agent] ?? run.agent}</span>
          </div>
          <div className="run-meta muted">
            {run.leadId ?? 'no lead'} · {run.durationMs} ms · {formatDateTime(run.startedAt)}
          </div>
          {run.detail && <p className="run-detail">{run.detail}</p>}
          {run.errorKind && <p className="run-error">Error: {run.errorKind}</p>}
        </li>
      ))}
    </ul>
  )
}
