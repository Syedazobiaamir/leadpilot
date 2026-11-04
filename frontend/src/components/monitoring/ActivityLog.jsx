import { formatDateTime } from '../../utils/formatters.js'

const TYPE_LABELS = {
  lead: 'Lead',
  ai: 'AI',
  automation: 'Automation',
  error: 'Error',
  recovery: 'Recovery',
  escalation: 'Escalation',
}

// A timeline of what happened in the system: the audit log.
export default function ActivityLog({ events, limit }) {
  const visible = limit ? events.slice(0, limit) : events

  if (visible.length === 0) {
    return <p className="empty-state">No activity yet.</p>
  }

  return (
    <ol className="activity-log">
      {visible.map((event) => (
        <li key={event.id} className="activity-item">
          <span className={`event-type type-${event.type}`}>{TYPE_LABELS[event.type] ?? event.type}</span>
          <div>
            <p className="activity-message">{event.message}</p>
            <time className="muted" dateTime={event.timestamp}>
              {formatDateTime(event.timestamp)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  )
}
