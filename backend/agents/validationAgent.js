// VALIDATION AGENT (Stage 5, decision 3A: rules only, no AI, so it's fast, free and predictable).
//
// The form (Zod) already checks the FORMAT of every field. This agent checks whether a
// correctly-formatted lead looks like a REAL customer: test entries, spam, vague or shouty
// messages, odd contact details. It never deletes or rejects a lead; it only sets flags,
// and a human decides.
//
//   severity "block"  → almost certainly not a real customer: the Orchestrator skips the AI (saves quota)
//   severity "review" → maybe fine, but a person should look ("Needs review" badge)

// Every flag this agent can set. Code → severity and an explanation for staff (no personal data).
export const REVIEW_FLAGS = {
  test_or_placeholder: { severity: 'block', label: 'Looks like a test or placeholder entry' },
  spam_content: { severity: 'block', label: 'Looks like spam (marketing offers or several links)' },
  contains_link: { severity: 'review', label: 'Message contains a link' },
  too_vague: { severity: 'review', label: 'Message is too short to understand the project' },
  all_caps: { severity: 'review', label: 'Message is written in all capital letters' },
  repeated_characters: { severity: 'review', label: 'Message has long runs of the same character' },
  suspicious_phone: { severity: 'review', label: 'Phone number looks made up (e.g. 123-456-7890)' },
  disposable_email: { severity: 'review', label: 'Email uses a temporary (disposable) address service' },
}

const PLACEHOLDER_NAMES = new Set(['test', 'testing', 'tester', 'test test', 'test user', 'asdf', 'qwerty', 'abc', 'xxx', 'john doe', 'jane doe', 'foo bar', 'no name', 'none'])
const PLACEHOLDER_MESSAGE = /^(test(ing)?|asdf|qwerty|hello|hi|xxx|abc)[\s.!?]*((test(ing)?|asdf|qwerty|xxx|abc)[\s.!?]*)*$/i
const LOREM = /lorem ipsum/i
// "test" as a separate WORD in the name ("Smoke Test", "Test Customer"), but not inside a real surname ("Testa").
const TEST_WORD_IN_NAME = /\b(test|testing|dummy)\b/i
// Messages that say they are a test (e.g. our own smoke test: "Automated smoke test lead. Safe to ignore.").
const TEST_MESSAGE = /\b(test (lead|entry|submission|message|inquiry)|smoke test|please ignore|safe to ignore)\b/i
const SPAM_WORDS = /\b(seo|backlinks?|crypto(currency)?|bitcoin|casino|betting|forex|viagra|cialis|payday loan|loan offer|guest post|web ?design services|rank (your|you) (site|website)|first page of google|make money|work from home)\b/i
const LINK = /(https?:\/\/|www\.)\S+/gi
// A short message that only asks for a quote/estimate/info, without saying what the project is.
const GENERIC_REQUEST = /^(hi|hello)?[\s,!.]*(i\s+)?(need|want|would like|looking for|requesting|request|get)\s+(a\s+|an\s+|some\s+)?(free\s+)?(quote|estimate|price|pricing|info|information|call ?back)\b/i
const DISPOSABLE_DOMAINS = new Set(['mailinator.com', 'yopmail.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com', 'temp-mail.org', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com'])

function phoneDigits(phone) {
  return String(phone ?? '').replace(/\D/g, '').slice(-10)
}

/**
 * Pure function: returns the flag codes for one lead (empty array = looks fine).
 * Only reads name, phone, email and message. Never changes anything.
 */
export function checkLeadQuality(lead) {
  const flags = new Set()
  const name = String(lead.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const message = String(lead.message ?? '').trim()
  const words = message.split(/\s+/).filter(Boolean)

  // Test / placeholder entries
  if (PLACEHOLDER_NAMES.has(name) || TEST_WORD_IN_NAME.test(name) || PLACEHOLDER_MESSAGE.test(message) || LOREM.test(message) || TEST_MESSAGE.test(message)) {
    flags.add('test_or_placeholder')
  }

  // Spam: marketing keywords, or several links
  const links = message.match(LINK) ?? []
  if (SPAM_WORDS.test(message) || links.length >= 2) flags.add('spam_content')
  else if (links.length === 1) flags.add('contains_link')

  // Message quality
  // Vague = very few words, or a short generic request with no project details.
  // (Word count alone flagged clear, short messages like "Roof leak after storm." as vague.)
  const vague = words.length < 4 || (words.length <= 8 && GENERIC_REQUEST.test(message))
  if (vague && !flags.has('test_or_placeholder')) flags.add('too_vague')
  const letters = message.replace(/[^a-z]/gi, '')
  if (letters.length >= 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) flags.add('all_caps')
  if (/(.)\1{5,}/.test(message)) flags.add('repeated_characters')

  // Contact details that look made up or temporary
  const digits = phoneDigits(lead.phone)
  if (/^(\d)\1{9}$/.test(digits) || ['1234567890', '0123456789', '9876543210'].includes(digits)) flags.add('suspicious_phone')
  const domain = String(lead.email ?? '').split('@')[1]?.toLowerCase()
  if (domain && DISPOSABLE_DOMAINS.has(domain)) flags.add('disposable_email')

  // Keep the catalog order, so the same lead always gets the same flag string.
  return Object.keys(REVIEW_FLAGS).filter((code) => flags.has(code))
}

/** True if any flag means "don't spend AI on this lead". */
export function isBlocked(flags) {
  return flags.some((code) => REVIEW_FLAGS[code]?.severity === 'block')
}

export const validationAgent = {
  name: 'validation',
  description: 'Checks whether a saved lead looks like a real customer (test entries, spam, vague text, odd contact details). Sets review flags; never deletes or rejects.',
  tools: ['readLead', 'setReviewFlags', 'writeActivity'], // no AI, no lead-field changes besides the flags

  async run({ input, tools }) {
    const lead = await tools.call('readLead', input.leadId)
    if (!lead) throw Object.assign(new Error(`Lead ${input.leadId} not found`), { kind: 'not_found' })

    const flags = checkLeadQuality(lead)
    await tools.call('setReviewFlags', lead.id, flags)
    const blocked = isBlocked(flags)
    if (flags.length > 0) {
      // Audit event with flag CODES only, never the customer's text.
      await tools.call('writeActivity', 'automation', `${lead.id} flagged for review: ${flags.join(', ')}${blocked ? ' (AI skipped)' : ''}`, lead.id)
    }
    return {
      flags,
      blocked,
      summary: flags.length === 0 ? 'no issues' : `${blocked ? 'blocked' : 'review'}: ${flags.join(', ')}`,
    }
  },
}
