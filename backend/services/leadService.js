// Business rules for leads. This file knows nothing about HTTP (no req/res).
// Controllers call it, and it uses the store for data.
// Errors are thrown as AppError with a fixed code, and the errorHandler turns them into responses.
import * as store from './leadStore.js'
import { AppError } from '../utils/AppError.js'
import { validateLead } from '../validation/leadSchema.js'
import { qualification } from './qualificationService.js'

// Lead IDs look like "LD-1001".
const LEAD_ID = /^LD-\d{1,10}$/

/**
 * Fills in the Stage 4 AI fields for leads created BEFORE Stage 4 (their cells are empty).
 * Before Stage 4 there was no AI at all, so any classification such a lead has was
 * written by hand: it is labelled 'simulated', never passed off as real AI output.
 */
export function withQualificationDefaults(lead) {
  const hasClass = Boolean(lead.classification)
  return {
    ...lead,
    qualificationStatus: lead.qualificationStatus ?? (hasClass ? 'qualified' : 'pending'),
    aiReason: lead.aiReason ?? null,
    aiModel: lead.aiModel ?? (hasClass ? 'simulated' : null),
    qualifiedAt: lead.qualifiedAt ?? null,
  }
}

/** All leads, newest first. */
export async function getLeads() {
  const leads = (await store.listLeads()).map(withQualificationDefaults)
  return leads.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function checkLeadId(id) {
  if (!LEAD_ID.test(id)) {
    throw new AppError(400, 'INVALID_LEAD_ID', 'Lead ID must look like LD-1001')
  }
}

/** One lead by ID. Throws 400 for a malformed ID, or 404 if it doesn't exist. */
export async function getLeadById(id) {
  checkLeadId(id)
  const lead = await store.findLeadById(id)
  if (!lead) {
    throw new AppError(404, 'LEAD_NOT_FOUND', `No lead found with ID ${id}`)
  }
  return withQualificationDefaults(lead)
}

/** Keeps only the last 10 digits, so "+1 (512) 555-0147" and "5125550147" match. */
function phoneDigits(phone) {
  return String(phone).replace(/\D/g, '').slice(-10)
}

/** Next ID = highest existing number + 1 (LD-1010 → LD-1011). */
function nextLeadId(leads) {
  const highest = leads.reduce((max, lead) => Math.max(max, Number(lead.id.slice(3)) || 0), 1000)
  return `LD-${highest + 1}`
}

/**
 * Creates a lead from untrusted input (whatever the client sent).
 * Throws:
 *  - 400 VALIDATION_ERROR: the input is wrong. This is a PERMANENT error, so retrying
 *    the same input will always fail. (The Recovery Agent will rely on this code in Stage 7.)
 *  - 409 DUPLICATE_LEAD: a lead with the same email or phone already exists.
 */
export async function createLead(input) {
  // Reject bodies that aren't a JSON object, e.g. missing, an array or a string.
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object with lead fields')
  }

  // Zod checks every field. Fields it doesn't know (e.g. "classification": "Hot",
  // "status": "Won") are DROPPED, so a client can't set values only the system should set.
  const result = validateLead(input)
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some lead fields are missing or invalid', result.errors)
  }
  const data = result.data

  // Duplicate protection. Email is already lowercased by the schema.
  const existing = await store.listLeads()
  const isDuplicate = existing.some(
    (lead) => lead.email === data.email || phoneDigits(lead.phone) === phoneDigits(data.phone),
  )
  if (isDuplicate) {
    // Don't reveal WHICH lead matched: this endpoint is public, and that would leak customer data.
    throw new AppError(409, 'DUPLICATE_LEAD', 'A lead with this email or phone number already exists')
  }

  const now = new Date().toISOString()
  const lead = {
    id: nextLeadId(existing),
    ...data,
    source: 'Website form',
    classification: null, // filled in by AI qualification (Stage 4)
    score: null,
    status: 'New', // the SALES status (New, Contacted, Won, ...), separate from the AI status below
    createdAt: now,
    qualificationStatus: 'pending', // pending → qualified | failed
    aiReason: null,
    aiModel: null,
    qualifiedAt: null,
  }
  await store.insertLead(lead)

  // Audit log: record what happened. Only the ID goes in, no personal data.
  await store.insertActivity({
    id: `EV-${Date.now()}-${lead.id}`,
    type: 'lead',
    message: `New lead ${lead.id} captured from website form (AI qualification pending)`,
    leadId: lead.id,
    timestamp: now,
  })

  // AI qualification runs in the BACKGROUND: the customer gets their answer now, and a
  // slow or failing AI can never lose or delay the lead. (Does nothing if AI is disabled.)
  qualification().start(lead.id)

  return lead
}

/**
 * (Re)qualifies a lead with AI, e.g. after a failure, or to replace a simulated classification.
 * Returns the lead marked "pending" right away. The AI result arrives a few seconds later.
 * Throws 400 (bad ID), 404 (unknown lead), 503 AI_UNAVAILABLE (AI not configured).
 */
export async function requalifyLead(id) {
  checkLeadId(id)
  return withQualificationDefaults(await qualification().requalify(id))
}
