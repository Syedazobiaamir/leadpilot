import { describeFlag, isBlockedLead } from '../../utils/reviewFlags.js'

// The Validation Agent's flags for one lead (Stage 5). Nothing is hidden or deleted:
// a person decides whether the lead is real.
export default function ReviewFlags({ flags = [] }) {
  if (flags.length === 0) return null
  const blocked = isBlockedLead(flags)

  return (
    <section className={`review-box ${blocked ? 'review-blocked' : ''}`} aria-label="Needs review">
      <h3>Needs review</h3>
      <p className="muted small">
        {blocked
          ? 'The Validation Agent thinks this may not be a real customer, so the AI was not used. You can still qualify it with AI below.'
          : 'The Validation Agent noticed something a person should check. The AI still ran.'}
      </p>
      <ul>
        {flags.map((code) => {
          const flag = describeFlag(code)
          return (
            <li key={code}>
              <span className={`badge badge-flag-${flag.severity}`}>{flag.severity === 'block' ? 'AI skipped' : 'check'}</span> {flag.label}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
