// n8n automation (Stage 6): the bridge between the backend and the n8n workflows.
//
// OUTGOING (backend → n8n), always in the BACKGROUND:
//   notifyLeadQualified(lead)        Hot lead           → event "lead.qualified"    → WF1 dashboard alert
//   notifyFollowUpApproved(followUp) a person approved  → event "followup.approved" → WF2 sends it (SIMULATED)
// If n8n is down, the lead/approval is still saved normally. The failure is logged and
// recorded as a failed workflow run, so the dashboard shows it honestly.
//
// INCOMING (n8n → backend), behind the x-automation-key check:
//   recordRun(input)   n8n reports how a workflow run went → the WorkflowRuns table
//
// Data minimization: events carry only what the workflow needs. No phone, no email,
// no last name and no ZIP ever leaves the backend (n8n only needs what it shows).
import { z } from 'zod'
import { AppError } from '../utils/AppError.js'
import { logger as defaultLogger } from '../utils/logger.js'
import { config } from '../config.js'
import * as leadStore from './leadStore.js'
import { createAutomationClient } from './automation/automationClient.js'
import { firstNameOf } from './ai/followUpPrompt.js'

// The workflow names shown on the dashboard. n8n uses the same names when it reports runs.
export const WORKFLOWS = {
  hotLeadAlert: 'Hot-lead alert',
  sendFollowUp: 'Send approved follow-up',
}

// What n8n may report about a run. Zod strips any other field.
const runSchema = z.object({
  // n8n's execution ID. Reporting the same execution twice UPDATES the run (no duplicates).
  executionId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'executionId must be 1-40 letters, digits, "-" or "_"'),
  workflow: z.string().trim().min(1).max(80),
  leadId: z.string().regex(/^LD-[A-Za-z0-9-]{1,40}$/, 'leadId must look like LD-...').nullish(),
  status: z.enum(['success', 'retrying', 'failed', 'escalated']),
  attempts: z.number().int().min(1).max(20),
  maxAttempts: z.number().int().min(1).max(20),
  lastError: z.string().max(1000).nullish(),
  startedAt: z.iso.datetime().optional(),
}).refine((run) => run.attempts <= run.maxAttempts, { message: 'attempts cannot be more than maxAttempts', path: ['attempts'] })

// What n8n may write to the activity log (Stage 6 decision D3 → A: alerts go to the dashboard,
// not to Slack). Only these three types: n8n can't pretend to be a lead, AI or error event.
const activitySchema = z.object({
  executionId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'executionId must be 1-40 letters, digits, "-" or "_"'),
  type: z.enum(['automation', 'escalation', 'recovery']),
  message: z.string().trim().min(1).max(500),
  leadId: z.string().regex(/^LD-[A-Za-z0-9-]{1,40}$/, 'leadId must look like LD-...').nullish(),
})

/**
 * Error messages from n8n can contain URLs with secrets in them (a Slack webhook URL IS a
 * password). Replace every URL, and keep the message short, before it is stored or shown.
 */
export function cleanErrorText(text) {
  if (!text) return null
  return String(text).replace(/https?:\/\/\S+/gi, '[URL hidden]').replace(/\s+/g, ' ').trim().slice(0, 300)
}

/**
 * client: an automationClient (or a fake in tests), or null when sending events is off
 * secret: AUTOMATION_SECRET, or null when n8n may not call us
 */
export function createAutomationService({ client = null, secret = null, store = leadStore, logger = defaultLogger, now = () => new Date() } = {}) {
  const running = new Set() // events being sent right now (for whenIdle)
  let counter = 0

  /** Sends an event in the background. Never throws: a failure is logged and recorded. */
  function emit(type, data, { workflow, leadId }) {
    if (!client) {
      logger.debug('automation off: event not sent', { type, leadId })
      return Promise.resolve(null)
    }
    const startedAt = now().toISOString()
    const job = client
      .send(type, data)
      .then((result) => {
        logger.info('automation event sent', { type, leadId, eventId: result.eventId })
        return result
      })
      .catch(async (err) => {
        logger.warn('automation event failed', { type, leadId, kind: err.kind ?? 'unknown', temporary: err.temporary ?? null, reason: err.message })
        // The workflow never started, so n8n can't record this run: we do. No retry yet (Stage 7).
        try {
          await store.insertWorkflowRun({
            id: `WF-be-${Date.now()}-${++counter}`,
            workflow,
            leadId: leadId ?? null,
            status: 'failed',
            attempts: 1,
            maxAttempts: 1,
            lastError: cleanErrorText(`Event not delivered to n8n: ${err.message}`),
            startedAt,
          })
        } catch (storeErr) {
          logger.error('could not record failed automation event', { type, leadId, error: storeErr.code ?? storeErr.message })
        }
        return null
      })
      .finally(() => running.delete(job))
    running.add(job)
    return job
  }

  return {
    /** True when n8n may call /api/automation/* (a secret is configured). */
    inboundEnabled: Boolean(secret),
    /** True when the backend sends events to n8n. */
    outboundEnabled: Boolean(client),
    secret,

    /** For a lead the AI just qualified. Only Hot leads trigger the alert. */
    notifyLeadQualified(lead) {
      if (lead?.classification !== 'Hot') return Promise.resolve(null)
      return emit('lead.qualified', {
        leadId: lead.id,
        firstName: firstNameOf(lead.name),
        serviceType: lead.serviceType,
        timeline: lead.timeline,
        classification: lead.classification,
        score: lead.score,
        reason: lead.aiReason ? String(lead.aiReason).slice(0, 200) : null,
      }, { workflow: WORKFLOWS.hotLeadAlert, leadId: lead.id })
    },

    /** For a draft a person just approved. n8n "sends" it (SIMULATED), then calls mark-sent. */
    notifyFollowUpApproved(followUp) {
      return emit('followup.approved', {
        followUpId: followUp.id,
        leadId: followUp.leadId,
        channel: followUp.channel,
        subject: followUp.subject,
        body: followUp.body, // already uses the customer's first name only (Stage 5)
        delivery: 'simulated', // Stage 6 decision D2A: no real message is sent to anyone
      }, { workflow: WORKFLOWS.sendFollowUp, leadId: followUp.leadId })
    },

    /**
     * n8n reports a run. Creates it, or updates it if this execution was reported before
     * (e.g. "retrying" first, then "success"). Returns { run, created }.
     */
    async recordRun(input) {
      const parsed = runSchema.safeParse(input ?? {})
      if (!parsed.success) {
        const details = {}
        for (const issue of parsed.error.issues) details[issue.path[0] ?? 'body'] ??= issue.message
        throw new AppError(400, 'VALIDATION_ERROR', 'The workflow run report is invalid', details)
      }
      const { executionId, startedAt, ...fields } = parsed.data
      const id = `WF-n8n-${executionId}`
      const values = { ...fields, leadId: fields.leadId ?? null, lastError: cleanErrorText(fields.lastError) }

      const existing = (await store.listWorkflowRuns()).find((run) => run.id === id)
      if (existing) {
        const run = await store.updateWorkflowRun(id, values) // startedAt stays the first report's
        return { run, created: false }
      }
      const run = await store.insertWorkflowRun({ id, ...values, startedAt: startedAt ?? now().toISOString() })
      return { run, created: true }
    },

    /**
     * n8n writes an alert to the activity log (the dashboard shows it). ONE event per n8n run:
     * if n8n retries after a timeout, the same run gets the same event, never a duplicate.
     * Returns { event, created }.
     */
    async recordActivity(input) {
      const parsed = activitySchema.safeParse(input ?? {})
      if (!parsed.success) {
        const details = {}
        for (const issue of parsed.error.issues) details[issue.path[0] ?? 'body'] ??= issue.message
        throw new AppError(400, 'VALIDATION_ERROR', 'The activity event is invalid', details)
      }
      const { executionId, type, message, leadId } = parsed.data
      const id = `EV-n8n-${executionId}`
      const existing = (await store.listActivity()).find((event) => event.id === id)
      if (existing) return { event: existing, created: false }
      const event = await store.insertActivity({
        id, type, message: cleanErrorText(message), leadId: leadId ?? null, timestamp: now().toISOString(),
      })
      return { event, created: true }
    },

    /** Resolves when no event is being sent. For tests and scripts. */
    async whenIdle() {
      while (running.size > 0) await Promise.all([...running])
    },
  }
}

// ---- The instance the app uses -------------------------------------------------------
function fromConfig() {
  const settings = config.automation
  if (!settings) return createAutomationService()
  const client = settings.webhookBaseUrl
    ? createAutomationClient({ baseUrl: settings.webhookBaseUrl, secret: settings.secret, timeoutMs: config.automationTimeoutMs })
    : null
  return createAutomationService({ client, secret: settings.secret })
}

let current = fromConfig()

export const automation = () => current

/** TESTS ONLY: replace the automation service (e.g. with a fake client and a test secret). */
export function useAutomationForTests(options = {}) {
  current = createAutomationService(options)
  return current
}
