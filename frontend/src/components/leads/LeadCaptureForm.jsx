import { useState } from 'react'
import { SERVICE_TYPES, TIMELINES, validateLead } from '../../validation/leadSchema.js'

const EMPTY_FORM = { name: '', phone: '', email: '', zip: '', serviceType: '', timeline: '', message: '' }

// The error message under one field. Its id links it to the input, so screen readers read it aloud.
function FieldError({ name, errors }) {
  if (!errors[name]) return null
  return (
    <p className="field-error" id={`lead-${name}-error`}>
      {errors[name]}
    </p>
  )
}

/**
 * Lead capture form.
 * onSubmit(data) must return a Promise of { success, lead?, errors? }.
 * The form doesn't know where the data goes, which makes it easy to test and reuse.
 */
export default function LeadCaptureForm({ onSubmit }) {
  const [values, setValues] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [savedLead, setSavedLead] = useState(null)

  function handleChange(event) {
    const { name, value } = event.target
    setValues((current) => ({ ...current, [name]: value }))
    // Clear that field's error as soon as the user starts fixing it.
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }))
  }

  async function handleSubmit(event) {
    event.preventDefault() // stop the browser's default full-page reload
    setSavedLead(null)

    // 1. Check in the browser first, for instant feedback.
    const check = validateLead(values)
    if (!check.success) {
      setErrors(check.errors)
      return
    }

    // 2. Send to the service, which validates again. Never trust only the UI.
    setSubmitting(true)
    try {
      const result = await onSubmit(check.data)
      if (result.success) {
        setSavedLead(result.lead)
        setValues(EMPTY_FORM)
        setErrors({})
      } else {
        setErrors(result.errors ?? { form: 'The lead could not be saved.' })
      }
    } catch (err) {
      // Never pretend it worked. Show the real failure.
      setErrors({ form: err.message || 'The lead could not be saved.' })
    } finally {
      setSubmitting(false)
    }
  }

  // Helper that wires up the label, value, error message and accessibility attributes for one field.
  function fieldProps(name) {
    return {
      id: `lead-${name}`,
      name,
      value: values[name],
      onChange: handleChange,
      'aria-invalid': errors[name] ? 'true' : undefined,
      'aria-describedby': errors[name] ? `lead-${name}-error` : undefined,
    }
  }

  return (
    <form className="card lead-form" onSubmit={handleSubmit} noValidate aria-label="New lead">
      {errors.form && (
        <p className="form-error" role="alert">
          {errors.form}
        </p>
      )}
      {savedLead && (
        <p className="form-success" role="status">
          Lead {savedLead.id} saved for {savedLead.name}. AI qualification is pending (simulated).
        </p>
      )}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="lead-name">Full name</label>
          <input {...fieldProps('name')} autoComplete="name" />
          <FieldError name="name" errors={errors} />
        </div>
        <div className="field">
          <label htmlFor="lead-phone">Phone</label>
          <input {...fieldProps('phone')} type="tel" autoComplete="tel" placeholder="(512) 555-0147" />
          <FieldError name="phone" errors={errors} />
        </div>
        <div className="field">
          <label htmlFor="lead-email">Email</label>
          <input {...fieldProps('email')} type="email" autoComplete="email" />
          <FieldError name="email" errors={errors} />
        </div>
        <div className="field">
          <label htmlFor="lead-zip">ZIP code</label>
          <input {...fieldProps('zip')} inputMode="numeric" autoComplete="postal-code" placeholder="78701" />
          <FieldError name="zip" errors={errors} />
        </div>
        <div className="field">
          <label htmlFor="lead-serviceType">Service needed</label>
          <select {...fieldProps('serviceType')}>
            <option value="">Select a service…</option>
            {SERVICE_TYPES.map((service) => (
              <option key={service}>{service}</option>
            ))}
          </select>
          <FieldError name="serviceType" errors={errors} />
        </div>
        <div className="field">
          <label htmlFor="lead-timeline">Timeline</label>
          <select {...fieldProps('timeline')}>
            <option value="">Select a timeline…</option>
            {TIMELINES.map((timeline) => (
              <option key={timeline}>{timeline}</option>
            ))}
          </select>
          <FieldError name="timeline" errors={errors} />
        </div>
        <div className="field field-full">
          <label htmlFor="lead-message">Project details</label>
          <textarea {...fieldProps('message')} rows={4} placeholder="Describe the project, urgency and budget…" />
          <FieldError name="message" errors={errors} />
        </div>
      </div>

      <button type="submit" className="button-primary" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save lead'}
      </button>
    </form>
  )
}
