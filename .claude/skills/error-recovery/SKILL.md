---
name: error-recovery
description: Rules for self-healing in this project (Stage 7): classifying errors as temporary or permanent, retry with exponential backoff and limits, recovery records and the Recovery Agent sweep, escalation to a person, idempotency and duplicate protection, partial writes, and honest reporting. Use when adding anything that can fail and should be retried or escalated, when touching retryPolicy / recoveryService / recoveryAgent / WF5, or when adding a write that may be repeated.
---

# Error recovery and self-healing

Design, limits and drill results: `docs/self-healing.md`. API: `docs/api-documentation.md`.

## 1. Classify every error
- Every error type has `kind` + `temporary` (`AiError`, `StorageError`, `AutomationError`). A new integration's
  error class must too (see the `api-integration` skill).
- `temporary: true` only when trying again later can really work (timeout, 5xx, rate limit, unreachable, the
  daily quota). Validation errors, wrong keys, not-found, conflicts are **permanent**.
- **Anything not clearly temporary is treated as permanent** (`decideRetry` does this). When unsure, escalate.

## 2. Never retry yourself: open a recovery record
- Don't write retry loops in services. Call `recovery().recordFailure({ kind, targetId, error })` and
  `recordSuccess({ kind, targetId })`. `retryPolicy.decideRetry` decides: backoff 5 → 10 → 20 min (max 60, at
  least the service's `retryAfter`), **max 4 tries**, permanent → escalate at once, `quota_exhausted` → wait for
  the reset without using a try.
- Both functions never throw: recording a problem must not create a new one.
- A new recoverable thing = a new `RECOVERY_KINDS` entry + a branch in the Recovery Agent + tests. Ask first: is
  it really safe to do twice? If not (it may already have happened, like a delivery), **escalate, never retry**.

## 3. The Recovery Agent (rules only, no AI)
- Runs as a sweep from n8n WF5 every 5 minutes (`POST /api/automation/recovery/sweep`). The backend must not run
  its own timers (they don't survive on serverless hosting).
- Its tools only read data, open/close/escalate records, retry an AI qualification, or hand an event to n8n again.
  Tool names may never contain send/delete/credential/exec words (the registry refuses them).
- Rebuild retried work from CURRENT data (re-read the follow-up/lead), never from a stored copy. If the problem went
  away by itself (already sent, no longer Hot), `resolve` the record instead of retrying.
- Limits protect shared resources: 3 AI retries per sweep, **5 per day** (free tier = 20), 5 hand-offs per sweep.
  Never spend AI on a lead the Validation Agent blocked.
- An escalated record stays with the person: no more automatic retries, even if their own retry fails.
- A sweep with nothing to do writes nothing (`shouldRecord`). Failed agent runs are always recorded.

## 4. Make repeated writes harmless (idempotency)
- Anything a client, n8n or the sweep may send twice must be safe twice: key it by something stable
  (`Idempotency-Key` header, n8n `$execution.id`, the record's own state) and return the first result again.
- Check-then-act must be atomic: one create at a time (`oneCreateAtATime`), one claim/mark-sent at a time per ID
  (`oneAtATime`). Limitation: in-process only; multiple server instances need a database-level lock.
- Before an action with an outside effect, **claim** it (state change that only one actor can win), then act,
  then confirm (e.g. approved → sending → sent).

## 5. Partial writes
- When the main write succeeded and a secondary one (audit event) failed, the request **succeeds** and the gap is
  logged with `logger.error`. Never report a saved lead as failed.
- A write that timed out may have happened: make the retry idempotent instead of guessing.

## 6. Honesty
- Never mark something recovered/sent/qualified unless it really is. Escalations say what failed, why, and
  what a person should check (no secrets: URLs are replaced with `[URL hidden]`).
- Every automatic retry and every escalation writes an activity event (`recovery` / `escalation`,
  "NEEDS A PERSON: …"), so the dashboard's Self-healing section and activity log tell the full story.

## 7. Testing (see `testing-qa`)
- Use a fake clock (`now`) and move it ("5 minutes later"); fake AI/n8n clients with `failWith`/`down()`.
- For races, make the store SLOW (`vi.mock` the store with a delayed read) or the race never shows.
- Mutation-check the important rules: remove the backoff / max tries / budget / queue / claim and make sure a
  test fails. Live drills on SIMULATED data; isolate risky ones (a second backend on another port with
  `DATA_STORE=memory`). Record drill results with run numbers in `docs/self-healing.md`.
- Don't poll `/api/health/ready` fast against Google Sheets: each call costs 7 of the 60 reads/minute.
