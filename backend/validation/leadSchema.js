// Lead validation rules, written with Zod.
// A "schema" describes what valid data looks like. Zod checks any input
// against it and tells us exactly which fields are wrong and why.
// SHARED FILE: an identical copy lives at backend/validation/leadSchema.js, so
// the browser and the server never disagree about what a valid lead is.
// Change BOTH copies together. A backend test (schemaSync.test.js) fails if they differ.
import { z } from 'zod'

export const SERVICE_TYPES = [
  'Roofing',
  'HVAC',
  'Plumbing',
  'Kitchen Remodel',
  'Bathroom Remodel',
  'Windows & Doors',
  'Siding',
  'Solar',
]

export const TIMELINES = ['ASAP', 'Within 1 month', '1-3 months', 'Just researching']

// Accepts common US formats: 5125550147, 512-555-0147, (512) 555-0147, +1 512 555 0147
const US_PHONE = /^(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/
// 5-digit ZIP, or ZIP+4 such as 78701-1234
const US_ZIP = /^\d{5}(-\d{4})?$/

// A text field with a clear message when it's missing or isn't text
// (e.g. an API call that leaves the field out, or sends a number).
const text = (label) => z.string({ message: `${label} is required` })

export const leadSchema = z.object({
  name: text('Name')
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(80, 'Name must be 80 characters or fewer'),
  phone: text('Phone number')
    .trim()
    .regex(US_PHONE, 'Enter a valid US phone number, e.g. (512) 555-0147'),
  email: text('Email').trim().toLowerCase().email('Enter a valid email address'),
  zip: text('ZIP code').trim().regex(US_ZIP, 'Enter a valid 5-digit US ZIP code'),
  serviceType: z.enum(SERVICE_TYPES, { message: 'Choose a service type' }),
  timeline: z.enum(TIMELINES, { message: 'Choose a project timeline' }),
  message: text('Project details')
    .trim()
    .min(10, 'Please describe the project in at least 10 characters')
    .max(1000, 'Message must be 1000 characters or fewer'),
})

/**
 * Validates raw form input.
 * Returns { success: true, data } with cleaned data (trimmed, lowercased email),
 * or { success: false, errors } where errors is { fieldName: 'message' }.
 */
export function validateLead(input) {
  const result = leadSchema.safeParse(input)

  if (result.success) {
    return { success: true, data: result.data }
  }

  // Keep only the first error per field so the form shows one clear message.
  const errors = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (field && !errors[field]) {
      errors[field] = issue.message
    }
  }
  return { success: false, errors }
}
