import LeadBadge from './LeadBadge.jsx'
import AiQualification from './AiQualification.jsx'
import ReviewFlags from './ReviewFlags.jsx'
import FollowUpPanel from './FollowUpPanel.jsx'
import { formatDateTime, formatPhone } from '../../utils/formatters.js'

export default function LeadDetail({ lead, onClose, onRequalify }) {
  if (!lead) return null

  return (
    <section className="card lead-detail" aria-labelledby="lead-detail-title">
      <div className="detail-head">
        <div>
          <h2 id="lead-detail-title">{lead.name}</h2>
          <p className="muted">
            {lead.id} · {lead.source}
          </p>
        </div>
        <button type="button" className="button-secondary" onClick={onClose}>
          Close
        </button>
      </div>

      <dl className="detail-list">
        <dt>Classification</dt>
        <dd>
          <LeadBadge classification={lead.classification} qualificationStatus={lead.qualificationStatus} />
          {lead.score != null && <span className="muted"> score {lead.score}/100</span>}
        </dd>
        <dt>Status</dt>
        <dd>{lead.status}</dd>
        <dt>Phone</dt>
        <dd>{formatPhone(lead.phone)}</dd>
        <dt>Email</dt>
        <dd>{lead.email}</dd>
        <dt>ZIP</dt>
        <dd>{lead.zip}</dd>
        <dt>Service</dt>
        <dd>{lead.serviceType}</dd>
        <dt>Timeline</dt>
        <dd>{lead.timeline}</dd>
        <dt>Received</dt>
        <dd>{formatDateTime(lead.createdAt)}</dd>
      </dl>

      <h3>Customer message</h3>
      <p className="lead-message">{lead.message}</p>

      <ReviewFlags flags={lead.reviewFlags} />
      <AiQualification key={lead.id} lead={lead} onRequalify={onRequalify} />
      <FollowUpPanel key={`followup-${lead.id}`} lead={lead} />
    </section>
  )
}
