// Business rules for leads. This file knows nothing about HTTP (no req/res).
// Controllers call it, and it uses the store for data.
// Errors are thrown as AppError with a fixed code, and the errorHandler turns them into responses.
import * as store from './leadStore.js'
import { AppError } from '../utils/AppError.js'
import { validateLead } from '../validation/leadSchema.js'
import { qualification } from './qualificationService.js'
import { orchestrator } from '../agents/orchestrator.js'
import { logger } from '../utils/logger.js'

// Lead IDs look like "LD-1001".
const LEAD_ID = /^LD-\d{1,10}$/

/**
 * Fills in the Stage 4 AI fields for leads created BEFORE Stage 4 (their cells are empty).
 * Before Stage 4 there was no AI at all, so any classification such a lead has was
 * written by hand: it is labelled 'simulated', never passed off as real AI output.
 */
export function withQualificationDefaults(lead) {
  const hasClass = Boolean(lead.classification)
  const { submissionKey, ...visible } = lead // Stage 7: internal, never returned by the API
  return {
    ...visible,
    qualificationStatus: lead.qualificationStatus ?? (hasClass ? 'qualified' : 'pending'),
    aiReason: lead.aiReason ?? null,
    aiModel: lead.aiModel ?? (hasClass ? 'simulated' : null),
    qualifiedAt: lead.qualifiedAt ?? null,
    // Stage 5: stored as one comma-separated cell; the API always returns an array.
    reviewFlags: parseReviewFlags(lead.reviewFlags),
  }
}

/** "too_vague,all_caps" → ['too_vague', 'all_caps']; null/empty → []. Arrays pass through. */
export function parseReviewFlags(value) {
  if (Array.isArray(value)) return value
  return String(value ?? '').split(',').map((code) => code.trim()).filter(Boolean)
}

/** All leads, newest first. */
export async function getLeads() {
  const leads = (await store.listLeads()).map(withQualificationDefaults)
  return leads.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function checkLeadId(id) {
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

// ---- Stage 7: duplicate protection ---------------------------------------------------
//
// 1. ONE CREATE AT A TIME. "Is it a duplicate?" and "save it" must happen together. Two requests
//    at the same moment could otherwise both pass the check (and even get the same LD- number),
//    because with Google Sheets each step takes a second or two. So creates wait in a queue.
//    Limitation: this works inside ONE server process. Several servers (e.g. serverless on Vercel)
//    would need a lock in the database itself (Stage 9 note).
//
// 2. IDEMPOTENCY KEY. The browser sends a random "Idempotency-Key" header with each form submission,
//    and the SAME key again if it retries (e.g. the answer was lost on a bad connection). If a lead
//    with that key already exists, we return it (201, header Idempotent-Replayed: true) instead of
//    a confusing 409 "duplicate", and never create a second lead.

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/
let createQueue = Promise.resolve()

/** Runs `work` after every earlier create has finished (a simple in-process lock). */
function oneCreateAtATime(work) {
  const job = createQueue.then(work)
  createQueue = job.catch(() => {}) // a failed create must not block the next one
  return job
}

/**
 * Creates a lead from untrusted input (whatever the client sent).
 * idempotencyKey: optional, from the Idempotency-Key header.
 * Returns { lead, replayed }. replayed: true = this key was used before; the existing lead is returned.
 * Throws:
 *  - 400 VALIDATION_ERROR: the input (or the key) is wrong. PERMANENT: retrying the same input always fails.
 *  - 409 DUPLICATE_LEAD: a lead with the same email or phone already exists.
 *  - 409 IDEMPOTENCY_KEY_REUSED: the key was already used for a DIFFERENT lead.
 */
export async function createLead(input, { idempotencyKey } = {}) {
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
  if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The Idempotency-Key header is invalid', { idempotencyKey: 'Use 8-100 letters, digits, "-" or "_"' })
  }

  const created = await oneCreateAtATime(() => saveNewLead(data, idempotencyKey))
  if (created.replayed) return { lead: withQualificationDefaults(created.lead), replayed: true }
  const { lead } = created

  // Audit log: record what happened. Only the ID goes in, no personal data.
  // Stage 7 (partial writes): the lead IS saved at this point. If only this audit event fails, the
  // request still succeeds (the customer's lead must not look lost); the gap is logged loudly.
  try {
    await store.insertActivity({
      id: `EV-${Date.now()}-${lead.id}`,
      type: 'lead',
      message: `New lead ${lead.id} captured from website form (AI qualification pending)`,
      leadId: lead.id,
      timestamp: lead.createdAt,
    })
  } catch (err) {
    logger.error('lead saved, but its audit event could not be written', { leadId: lead.id, error: err.code ?? err.message })
  }

  // The agents run in the BACKGROUND (Orchestrator: validation → AI qualification → follow-up
  // draft for Hot leads). The customer gets their answer now, and a slow or failing AI can
  // never lose or delay the lead.
  orchestrator().start(lead.id)

  return { lead: withQualificationDefaults(lead), replayed: false } // same shape as GET (e.g. reviewFlags as an array)
}

/** Inside the queue: replay check, duplicate check, then save. Returns { lead, replayed }. */
async function saveNewLead(data, idempotencyKey) {
  const existing = await store.listLeads()

  if (idempotencyKey) {
    const earlier = existing.find((lead) => lead.submissionKey === idempotencyKey)
    if (earlier) {
      // Same key, same person → the browser retried: return the lead we already saved.
      if (earlier.email === data.email && phoneDigits(earlier.phone) === phoneDigits(data.phone)) return { lead: earlier, replayed: true }
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different lead')
    }
  }

  // Duplicate protection. Email is already lowercased by the schema.
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
    reviewFlags: null, // set by the Validation Agent (Stage 5)
    submissionKey: idempotencyKey ?? null, // Stage 7: lets a retry of the same submission be recognised
  }
  await store.insertLead(lead)
  return { lead, replayed: false }
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
