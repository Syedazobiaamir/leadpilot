import { useEffect } from 'react'
import '../../App.css'
import LeadCaptureForm from '../leads/LeadCaptureForm.jsx'
import { createLead } from '../../services/leadService.js'

// Customer-facing wording for errors (the staff dashboard shows the technical message instead).
const FRIENDLY_ERRORS = {
  DUPLICATE_LEAD: 'We already have a request with this email or phone number. We will be in touch soon.',
  RATE_LIMITED: 'Too many requests were sent from your network. Please wait a minute and try again.',
  SUBMISSION_REJECTED: 'Your request could not be sent. Please try again.',
}
const GENERIC_ERROR = 'Sorry, we could not send your request right now. Please try again in a minute.'

const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0]

/**
 * Stage 9: the PUBLIC page where customers request an estimate (/request). No login.
 * It shows NO customer data: it only sends the form. Protection is on the server
 * (validation, 10 requests/min per IP, the honeypot field, duplicate check).
 */
export default function RequestPage() {
  useEffect(() => {
    document.title = 'Request a free estimate'
  }, [])

  // Same server call as the dashboard, but customer-friendly error texts.
  // Field errors (e.g. "Enter a valid ZIP code") are already written for people and stay as they are.
  async function send(data, options) {
    const result = await createLead(data, options)
    if (result.success || !result.errors?.form) return result
    const text = FRIENDLY_ERRORS[result.code] ?? GENERIC_ERROR
    return { ...result, errors: { ...result.errors, form: result.reference ? `${text} (reference: ${result.reference})` : text } }
  }

  return (
    <main className="public-shell">
      <header className="public-header">
        <h1>Request a free estimate</h1>
        <p className="muted">
          Tell us about your home-improvement project. We will contact you by phone or email to talk about the details.
        </p>
      </header>

      <LeadCaptureForm
        onSubmit={send}
        label="Request an estimate"
        submitText="Send request"
        submittingText="Sending…"
        successText={(lead) => `Thank you, ${firstName(lead.name)}! We received your request and will contact you soon.`}
      />

      <p className="muted small public-note">
        We use your details only to answer this request. We never sell them.
      </p>
    </main>
  )
}
