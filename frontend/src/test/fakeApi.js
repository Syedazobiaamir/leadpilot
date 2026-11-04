// A fake backend for tests. It replaces the global fetch() with a function that
// answers like our Express API, using in-memory fixture data.
// Tests can then render the real app without a running server, and can also
// simulate failures (server down, 500 errors).
import { vi } from 'vitest'
import { sampleLeads } from './fixtures/sampleLeads.js'
import { sampleActivity } from './fixtures/sampleActivity.js'
import { sampleWorkflowRuns } from './fixtures/sampleWorkflowRuns.js'
import { validateLead } from '../validation/leadSchema.js'

/** Builds a real Response object, like the one fetch() returns. */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const newestFirst = (field) => (a, b) => b[field].localeCompare(a[field])

/**
 * Installs the fake API and returns its state, so tests can inspect it.
 * options.failWith: 'network' makes every request fail as if the server were down.
 */
export function installFakeApi({ failWith } = {}) {
  const db = {
    leads: structuredClone(sampleLeads),
    activity: structuredClone(sampleActivity),
    workflowRuns: structuredClone(sampleWorkflowRuns),
  }

  const fetchMock = vi.fn(async (url, options = {}) => {
    if (failWith === 'network') throw new TypeError('Failed to fetch')

    const method = options.method ?? 'GET'
    const path = String(url)

    if (method === 'GET' && path === '/api/leads') {
      const data = [...db.leads].sort(newestFirst('createdAt'))
      return jsonResponse({ data, count: data.length })
    }
    if (method === 'GET' && path === '/api/activity') {
      return jsonResponse({ data: [...db.activity].sort(newestFirst('timestamp')) })
    }
    if (method === 'GET' && path === '/api/workflow-runs') {
      return jsonResponse({ data: [...db.workflowRuns].sort(newestFirst('startedAt')) })
    }
    if (method === 'POST' && path === '/api/leads') {
      const result = validateLead(JSON.parse(options.body))
      if (!result.success) {
        return jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'Invalid', details: result.errors } }, 400)
      }
      if (db.leads.some((l) => l.email === result.data.email)) {
        return jsonResponse({ error: { code: 'DUPLICATE_LEAD', message: 'A lead with this email or phone number already exists' } }, 409)
      }
      const now = new Date().toISOString()
      const lead = { id: `LD-${1001 + db.leads.length}`, ...result.data, source: 'Website form', classification: null, score: null, status: 'New', createdAt: now }
      db.leads.push(lead)
      db.activity.push({ id: `EV-${lead.id}`, type: 'lead', message: `New lead ${lead.id} captured`, leadId: lead.id, timestamp: now })
      return jsonResponse({ data: lead }, 201)
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: `Route ${method} ${path} not found` } }, 404)
  })

  vi.stubGlobal('fetch', fetchMock)
  return { db, fetchMock }
}
