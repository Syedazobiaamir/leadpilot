// Labels for the Validation Agent's flag codes (Stage 5). The codes come from the backend
// (backend/agents/validationAgent.js, REVIEW_FLAGS). Unknown codes are shown as-is.
//   block  = the lead looks like a test or spam: the AI was not used for it
//   review = probably fine, but a person should take a look
export const REVIEW_FLAG_INFO = {
  test_or_placeholder: { severity: 'block', label: 'Looks like a test or placeholder entry' },
  spam_content: { severity: 'block', label: 'Looks like spam (marketing offers or several links)' },
  contains_link: { severity: 'review', label: 'Message contains a link' },
  too_vague: { severity: 'review', label: 'Message is too short to understand the project' },
  all_caps: { severity: 'review', label: 'Message is written in all capital letters' },
  repeated_characters: { severity: 'review', label: 'Message has long runs of the same character' },
  suspicious_phone: { severity: 'review', label: 'Phone number looks made up' },
  disposable_email: { severity: 'review', label: 'Email uses a temporary (disposable) address' },
}

/** Code → { code, severity, label }, for display. */
export function describeFlag(code) {
  return { code, ...(REVIEW_FLAG_INFO[code] ?? { severity: 'review', label: code }) }
}

/** True if any flag means the AI was skipped for this lead. */
export function isBlockedLead(flags = []) {
  return flags.some((code) => describeFlag(code).severity === 'block')
}
