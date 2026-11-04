// SIMULATED DATA: an example activity/audit log.
// From Stage 2 onward, the backend will write these events for real.
// type: 'lead' | 'ai' | 'automation' | 'error' | 'recovery' | 'escalation'

export const sampleActivity = [
  { id: 'EV-5012', type: 'lead', message: 'New lead LD-1001 captured from website form', leadId: 'LD-1001', timestamp: '2026-11-03T14:05:00Z' },
  { id: 'EV-5013', type: 'ai', message: 'LD-1001 classified as Hot (score 92): urgent storm damage', leadId: 'LD-1001', timestamp: '2026-11-03T14:05:04Z' },
  { id: 'EV-5014', type: 'automation', message: 'Follow-up SMS draft generated for LD-1001', leadId: 'LD-1001', timestamp: '2026-11-03T14:05:09Z' },
  { id: 'EV-5011', type: 'error', message: 'Google Sheets write timed out for LD-1002 (attempt 1 of 3)', leadId: 'LD-1002', timestamp: '2026-11-03T11:42:06Z' },
  { id: 'EV-5010', type: 'recovery', message: 'Retry succeeded for LD-1002 after 2s backoff', leadId: 'LD-1002', timestamp: '2026-11-03T11:42:09Z' },
  { id: 'EV-5009', type: 'escalation', message: 'Slack notification failed 3 times; escalated to owner for review', leadId: 'LD-1003', timestamp: '2026-11-02T19:21:30Z' },
  { id: 'EV-5008', type: 'lead', message: 'New lead LD-1003 captured from referral', leadId: 'LD-1003', timestamp: '2026-11-02T19:20:00Z' },
  { id: 'EV-5007', type: 'error', message: 'Lead rejected: invalid ZIP code "9021" (not retried, validation error)', leadId: null, timestamp: '2026-11-01T12:10:00Z' },
]
