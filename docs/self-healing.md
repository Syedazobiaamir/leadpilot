# Self-healing and error recovery (Stage 7)

**Goal:** when something fails, the system first tries to fix it by itself, within strict limits, and only
calls a person when it can't. It never retries what can't work, never retries forever, never spends the
whole AI quota on retries, and never pretends something worked.

## The pieces

```
 something fails ──► recoveryService.recordFailure ──► retryPolicy.decideRetry ──► Recoveries tab
                     (one open record per problem)      "retry at <time>" or            (Google Sheet)
                                                        "escalate to a person"
 every 5 min: n8n WF5 ──► POST /api/automation/recovery/sweep ──► Recovery Agent (rules, no AI)
                                                                    finds stuck / lost work,
                                                                    retries what is due, within limits
 it works ──► recoveryService.recordSuccess ──► record "recovered"
```

| File | Job |
|---|---|
| `backend/services/recovery/retryPolicy.js` | Pure rules: retry or escalate, and when |
| `backend/services/recoveryService.js` | Opens, updates and closes recovery records; writes the activity events |
| `backend/agents/recoveryAgent.js` | The Recovery Agent and its `sweep()` |
| `automation/workflows/wf5-recovery-sweep.json` | n8n WF5: triggers a sweep every 5 minutes |
| `frontend/src/components/monitoring/RecoveryList.jsx` | Dashboard → Automation → "Self-healing" |

## The retry rules (`retryPolicy.js`)

| Error | Decision |
|---|---|
| Permanent (`temporary: false`: wrong key, model not found, workflow not active, 4xx…) | **Escalate at once.** Retrying can't fix it |
| Unknown (not clearly temporary) | **Escalate** ("to be safe it is not retried automatically") |
| `quota_exhausted` (the DAILY AI limit) | Wait until the quota resets (Google's `retryDelay`, else 1 h). **Doesn't count as a try** |
| Other temporary (timeout, 5xx, n8n unreachable, rate limit…) | **Exponential backoff:** 5 → 10 → 20 min (capped at 60), and at least what the service asked (`retryAfter`) |
| Still failing after **4 tries** | **Escalate** |

Every error class in the project already carries `kind` + `temporary` (`AiError`, `StorageError`,
`AutomationError`), so the policy needs nothing else.

## What can be recovered (record `kind`)

| Kind | Target | Opened when | The sweep… |
|---|---|---|---|
| `qualification` | lead | AI qualification fails; a lead is stuck "pending" 10+ min; an old "failed" lead has no record | runs the AI qualification again (max **3 per sweep**, **5 per day**, never for leads the Validation Agent blocked) |
| `followup_event` | follow-up | `followup.approved` didn't reach n8n; a follow-up is stuck "approved" 15+ min | hands the event to n8n again, rebuilt from the CURRENT follow-up (max 5 per sweep); closes it if n8n already has it |
| `hot_lead_event` | lead | `lead.qualified` (Hot) didn't reach n8n | hands it off again; closes it if the lead is no longer Hot |
| `followup_delivery` | follow-up | a follow-up is stuck "sending" 15+ min | **never retries:** it may already have been delivered → escalate at once |

Record life cycle: `pending_retry` → `recovered`, or → `escalated` (a person must look) → `recovered` when a
person fixes it. An escalated record gets **no** more automatic retries, even if the person's own retry fails.

## Duplicate protection

| Problem | Protection |
|---|---|
| Two identical lead submissions at the same moment (check-then-insert race; also duplicate IDs) | Creates run **one at a time** (in-process queue) |
| A retried submission after a lost answer | `Idempotency-Key` header (the form sends one random key per submission): the same key returns the SAME lead (201 + `Idempotent-Replayed: true`), never a second lead or a confusing 409 |
| The same key for a different person | `409 IDEMPOTENCY_KEY_REUSED` (reveals nothing about the first lead) |
| The same follow-up sent twice (duplicate events, retries) | WF2 **claims** it first (approved → `sending`, one winner per n8n run); `mark-sent` only works after a claim and is idempotent |
| n8n retrying writes | All n8n writes are idempotent per execution (`WF-n8n-<id>`, `EV-n8n-<id>`) |

## Partial writes
- A lead saved but its audit event failed → the request still succeeds (201) and the gap is logged. The
  customer's lead is never reported as lost.
- A lead saved but the answer lost (timeout) → the browser retries with the same key → the same lead comes back.

## n8n: retry only what can work
Every backend call in WF1–WF5 is an HTTP node with "Never error" + "Full response": its Retry On Fail (3×, 5 s)
then only retries **network failures** (no answer). A `Check: <step>` node lets 2xx through and fails the run
on anything else, labelled **TEMPORARY** (408/429/5xx) or **PERMANENT** (other 4xx, not retried). A failed run →
WF4 → "NEEDS A PERSON" on the dashboard. Lost hand-offs are retried by the backend's Recovery Agent.

## Verified
**Automated:** 509 backend + 82 frontend tests, including `retryPolicy.test.js` (18), `recovery.test.js` (29),
`duplicateProtection.test.js` (12, with a deliberately SLOW store), claim/mark-sent tests. Mutation checks:
≈20 deliberate bugs (no backoff, no max tries, retrying permanent errors, no daily budget, re-sending a stuck
"sending", no create queue, …), all caught; one that wasn't caught at first got a new test.

**Live (real n8n, the developer's Google Sheet, SIMULATED data):**

| Drill | Result |
|---|---|
| n8n stopped, a follow-up approved | approval OK → record `pending_retry` (unreachable) → n8n started → sweep 5 min later → claimed by run #43 → **sent**; "Recovered: n8n hand-off … worked after 2 tries" |
| The same event sent again | WF2 run #44 stopped quietly (claimed: false) |
| An event for a follow-up that doesn't exist | PERMANENT in 1.2 s (before: ~12 s of useless retries) → escalated (#47) |
| 4 identical submissions with one key at the same moment | 1 lead (LD-1017), 3 replays |
| AI with a wrong model name (separate memory instance on port 3002) | escalated on the first failure, the sweep did not retry, 1 AI call in total |
| WF5 on schedule | run #54: sweep 200 in 1.6 s, nothing to do, no AgentRuns row written |
| Readiness during a real outage (Recoveries tab missing) | WF3 alert 07:40 → WF4 escalation → "Recovered … about 10 min" 07:50 |

## Limitations
- The create queue works inside **one server process**. Several instances (e.g. serverless on Vercel) need a
  lock in the database itself (Stage 9).
- The Recovery Agent depends on n8n WF5. If n8n is down, nothing sweeps (records wait, nothing is lost).
- A temporary AI failure was not reproduced live (only in tests); permanent AI, n8n outage and storage outage were.
- A follow-up stuck in "sending" always needs a person: the system can't know whether it was delivered.
- Polling `/api/health/ready` fast exhausts Google's 60 reads/min (each check = 7 reads). Stage 8: cache or rate-limit it.
- Recovery decisions are rules, not AI: predictable and free, but they only handle the cases listed above.
