import { useState } from 'react'
import { useFollowUps } from '../../hooks/useFollowUps.js'
import { formatDateTime } from '../../utils/formatters.js'

const STATUS_TEXT = {
  draft: 'AI draft · not sent · needs approval',
  approved: 'Approved · waiting for n8n to send it',
  sending: 'n8n is sending it (SIMULATED) · locked so it can only go out once',
  rejected: 'Rejected · will not be sent',
  sent: 'Sent by n8n · SIMULATED: no real email reached the customer',
}

// The follow-up email for one lead. The AI only writes DRAFTS; a person approves, edits or
// rejects them. This screen never sends anything: after approval, n8n does (Stage 6,
// SIMULATED for now), and the status changes to "sent" when n8n reports back.
export default function FollowUpPanel({ lead }) {
  const { followUps, loading, error, generating, waitingForSend, sendNote, requestDraft, approve, reject, edit } = useFollowUps(lead.id)
  const [editing, setEditing] = useState(null) // { id, subject, body } while editing
  const [busy, setBusy] = useState(false)

  const latest = followUps[0] ?? null
  const canRequest = !generating && latest?.status !== 'draft' // one open draft at a time

  async function run(action) {
    setBusy(true)
    try {
      return await action()
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    const result = await run(() => edit(editing.id, { subject: editing.subject, body: editing.body }))
    if (result.success) setEditing(null)
  }

  return (
    <section className="ai-box" aria-label="Follow-up">
      <h3>Follow-up email</h3>

      {loading && <p className="muted">Loading…</p>}

      {!loading && !latest && !generating && (
        <p className="muted">No follow-up yet. Hot leads get an AI draft automatically; for others, ask for one.</p>
      )}

      {generating && (
        <p className="ai-pending" role="status">
          The AI is writing a draft… This usually takes a few seconds.
        </p>
      )}

      {latest && !editing && (
        <article className={`followup followup-${latest.status}`}>
          <p className="followup-status">
            <span className={`badge badge-followup-${latest.status}`}>{latest.status}</span>{' '}
            <span className="muted">{STATUS_TEXT[latest.status] ?? latest.status}</span>
          </p>
          <p className="followup-subject">
            <strong>Subject:</strong> {latest.subject}
          </p>
          <pre className="followup-body">{latest.body}</pre>
          <p className="muted small">
            Written by {latest.aiModel} · {formatDateTime(latest.createdAt)}
            {latest.editedAt && ` · edited ${formatDateTime(latest.editedAt)}`}
            {latest.decidedAt && ` · ${latest.status === 'sent' ? 'approved' : latest.status} ${formatDateTime(latest.decidedAt)}`}
            {latest.sentAt && ` · sent ${formatDateTime(latest.sentAt)} (${latest.sentVia ?? 'unknown'})`}
          </p>

          {waitingForSend && (latest.status === 'approved' || latest.status === 'sending') && (
            <p className="ai-pending" role="status">
              Waiting for n8n to send it (SIMULATED)…
            </p>
          )}
          {sendNote && (latest.status === 'approved' || latest.status === 'sending') && <p className="muted small">{sendNote}</p>}

          {latest.status === 'draft' && (
            <div className="button-row">
              <button type="button" className="button-primary" disabled={busy} onClick={() => run(() => approve(latest.id))}>
                Approve
              </button>
              <button type="button" className="button-secondary" disabled={busy} onClick={() => setEditing({ id: latest.id, subject: latest.subject, body: latest.body })}>
                Edit
              </button>
              <button type="button" className="button-secondary" disabled={busy} onClick={() => run(() => reject(latest.id))}>
                Reject
              </button>
            </div>
          )}
        </article>
      )}

      {editing && (
        <form
          className="followup-edit"
          aria-label="Edit follow-up"
          onSubmit={(event) => {
            event.preventDefault()
            saveEdit()
          }}
        >
          <div className="field">
            <label htmlFor="followup-subject">Subject</label>
            <input id="followup-subject" value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="followup-body">Message</label>
            <textarea id="followup-body" rows={9} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
          </div>
          <div className="button-row">
            <button type="submit" className="button-primary" disabled={busy}>
              Save draft
            </button>
            <button type="button" className="button-secondary" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {canRequest && !editing && (
        <button type="button" className="button-secondary" disabled={busy} onClick={() => run(requestDraft)}>
          {latest ? 'Draft a new follow-up with AI' : 'Draft follow-up with AI'}
        </button>
      )}
    </section>
  )
}
