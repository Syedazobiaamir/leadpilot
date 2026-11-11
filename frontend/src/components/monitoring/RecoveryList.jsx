import { formatDateTime } from '../../utils/formatters.js'

// What each problem is about (same kinds as backend/services/recoveryService.js).
const KIND_LABELS = {
  qualification: 'AI qualification',
  followup_event: 'Hand-off to n8n (follow-up)',
  hot_lead_event: 'Hot-lead alert to n8n',
  followup_delivery: 'Follow-up delivery',
}

const STATUS = {
  pending_retry: { text: 'Retrying', css: 'retrying' },
  recovered: { text: 'Recovered', css: 'success' },
  escalated: { text: 'Needs a person', css: 'escalated' },
}

const MAX_ATTEMPTS = 4 // backend/services/recovery/retryPolicy.js

// Stage 7: the self-healing record. One row per problem the system tried to fix by itself:
// still retrying (and when), fixed, or handed to a person. Problems that need a person come first.
export default function RecoveryList({ records, limit }) {
  const order = { escalated: 0, pending_retry: 1, recovered: 2 }
  const sorted = [...records].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.updatedAt.localeCompare(a.updatedAt))
  const visible = limit ? sorted.slice(0, limit) : sorted

  if (visible.length === 0) {
    return <p className="empty-state">Nothing to recover. Problems the system fixes by itself (or hands to a person) appear here.</p>
  }

  return (
    <ul className="run-list" aria-label="Recoveries">
      {visible.map((record) => {
        const status = STATUS[record.status] ?? { text: record.status, css: 'failed' }
        return (
          <li key={record.id} className={`run run-${status.css}`}>
            <div className="run-main">
              <span className={`status-pill status-${status.css}`}>{status.text}</span>
              <span className="run-name">
                {KIND_LABELS[record.kind] ?? record.kind} · {record.targetId}
              </span>
            </div>
            <div className="run-meta muted">
              {record.status === 'pending_retry' && record.nextRetryAt && <>next try {formatDateTime(record.nextRetryAt)} · </>}
              tries {record.attempts}/{MAX_ATTEMPTS} · updated {formatDateTime(record.updatedAt)}
            </div>
            {record.lastError && record.status !== 'recovered' && (
              <p className="run-error">
                Last error ({record.lastErrorKind ?? 'unknown'}): {record.lastError}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
