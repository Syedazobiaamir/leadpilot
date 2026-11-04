// SIMULATED DATA: example automation workflow runs (the kind n8n will run in Stage 6).
// status: 'success' | 'retrying' | 'failed' | 'escalated'

export const sampleWorkflowRuns = [
  { id: 'WF-9031', workflow: 'Lead intake → Google Sheets', leadId: 'LD-1001', status: 'success', attempts: 1, maxAttempts: 3, lastError: null, startedAt: '2026-11-03T14:05:01Z' },
  { id: 'WF-9032', workflow: 'AI qualification', leadId: 'LD-1001', status: 'success', attempts: 1, maxAttempts: 3, lastError: null, startedAt: '2026-11-03T14:05:02Z' },
  { id: 'WF-9028', workflow: 'Lead intake → Google Sheets', leadId: 'LD-1002', status: 'success', attempts: 2, maxAttempts: 3, lastError: 'Request timed out after 10s', startedAt: '2026-11-03T11:42:05Z' },
  { id: 'WF-9029', workflow: 'Follow-up email send', leadId: 'LD-1002', status: 'retrying', attempts: 2, maxAttempts: 3, lastError: '503 Service Unavailable from email provider', startedAt: '2026-11-03T11:43:00Z' },
  { id: 'WF-9025', workflow: 'Slack hot-lead alert', leadId: 'LD-1003', status: 'escalated', attempts: 3, maxAttempts: 3, lastError: 'Slack webhook returned 404 (webhook URL may be revoked)', startedAt: '2026-11-02T19:20:30Z' },
  { id: 'WF-9020', workflow: 'Lead intake → Google Sheets', leadId: null, status: 'failed', attempts: 1, maxAttempts: 1, lastError: 'Validation error: invalid ZIP code (permanent, not retried)', startedAt: '2026-11-01T12:10:00Z' },
  { id: 'WF-9018', workflow: 'AI qualification', leadId: 'LD-1004', status: 'success', attempts: 1, maxAttempts: 3, lastError: null, startedAt: '2026-10-30T16:10:03Z' },
  { id: 'WF-9015', workflow: 'Follow-up email send', leadId: 'LD-1004', status: 'success', attempts: 1, maxAttempts: 3, lastError: null, startedAt: '2026-10-30T16:11:00Z' },
]
