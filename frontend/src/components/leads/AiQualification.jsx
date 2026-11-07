import { useState } from 'react'
import { formatDateTime } from '../../utils/formatters.js'

// The "AI qualification" part of the lead detail: what the AI decided and why, WHO decided it
// (real Gemini model, or a hand-written SIMULATED sample), and a button to (re)run the AI.
export default function AiQualification({ lead, onRequalify }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const status = lead.qualificationStatus ?? 'pending'
  const simulated = lead.aiModel === 'simulated'
  // A failed RE-run keeps the previous result (the server never throws it away), so show it,
  // instead of hiding a still-valid classification behind the failure message.
  const hasResult = Boolean(lead.classification)

  async function handleClick() {
    setBusy(true)
    setError(null)
    try {
      const result = await onRequalify(lead.id)
      if (!result.success) setError(result.error) // e.g. "AI qualification is not configured on this server."
    } finally {
      setBusy(false)
    }
  }

  const buttonLabel = status === 'failed' ? 'Retry AI' : simulated ? 'Qualify with AI' : 'Re-run AI'

  return (
    <section className="ai-box" aria-label="AI qualification">
      <h3>AI qualification</h3>

      {status === 'pending' && (
        <p className="ai-pending" role="status">
          AI is analyzing this inquiry… This usually takes a few seconds.
        </p>
      )}

      {status === 'failed' && (
        <p className="ai-failed">
          {hasResult
            ? 'The latest AI run failed. The previous result below is kept. (Details are in the activity log.)'
            : 'AI qualification failed. The lead is saved, and you can try again. (Details are in the activity log.)'}
        </p>
      )}

      {hasResult && status !== 'pending' && (
        <>
          <p className="ai-source">
            {simulated ? (
              <>
                <span className="badge badge-simulated">Simulated</span> hand-written sample, not a real AI result
              </>
            ) : (
              <>
                <span className="badge badge-ai">Gemini AI</span> {lead.aiModel}
                {lead.qualifiedAt && <span className="muted"> · {formatDateTime(lead.qualifiedAt)}</span>}
              </>
            )}
          </p>
          {lead.aiReason && <p className="ai-reason">“{lead.aiReason}”</p>}
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {status !== 'pending' && (
        <button type="button" className="button-secondary" onClick={handleClick} disabled={busy}>
          {busy ? 'Starting…' : buttonLabel}
        </button>
      )}
    </section>
  )
}
