import LeadBadge from './LeadBadge.jsx'
import { formatDateTime, formatPhone } from '../../utils/formatters.js'

export default function LeadTable({ leads, selectedId, onSelect }) {
  if (leads.length === 0) {
    return <p className="empty-state">No leads match these filters.</p>
  }

  return (
    <div className="table-wrap">
      <table className="lead-table">
        <thead>
          <tr>
            <th scope="col">Customer</th>
            <th scope="col">Service</th>
            <th scope="col">Class</th>
            <th scope="col">Score</th>
            <th scope="col">Status</th>
            <th scope="col">Received</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} className={lead.id === selectedId ? 'selected' : ''}>
              <td>
                {/* A real button, so keyboard and screen-reader users can open the details too. */}
                <button type="button" className="link-button" onClick={() => onSelect(lead.id)}>
                  {lead.name}
                </button>
                <span className="cell-sub muted">{formatPhone(lead.phone)}</span>
              </td>
              <td>{lead.serviceType}</td>
              <td>
                <LeadBadge classification={lead.classification} qualificationStatus={lead.qualificationStatus} />
              </td>
              <td>{lead.score ?? '—'}</td>
              <td>{lead.status}</td>
              <td className="nowrap">{formatDateTime(lead.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
