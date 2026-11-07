# API Documentation

REST API served by the Express backend (`backend/`).

- **Base URL (development):** `http://localhost:3001/api`, or `http://localhost:5173/api` through the Vite proxy
- **Format:** JSON requests and responses (`Content-Type: application/json`)
- **Authentication:** none yet (planned before deployment)
- **Data:** set by `DATA_STORE` in `backend/.env`:
  - `memory` (default): in-memory store seeded with **simulated sample data**. It resets on every server restart.
  - `sheets`: **Google Sheets** (tabs `Leads`, `Activity`, `WorkflowRuns`). Data persists. Setup: [`google-sheets-setup.md`](google-sheets-setup.md).
- **Any endpoint that touches data** can return `503 STORAGE_UNAVAILABLE` when storage (Google Sheets) is unreachable or misconfigured. See the error reference.

---

## Conventions

### Success responses
```json
{ "data": { ... } }                 // one item
{ "data": [ ... ], "count": 10 }    // a list
```

### Error responses
Every error has the same shape:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some lead fields are missing or invalid",
    "details": { "zip": "Enter a valid 5-digit US ZIP code" },
    "requestId": "4ba8284f-03a6-4e2c-8769-2b5c34073e75"
  }
}
```
- `code` is stable and machine-readable. **Base your program's logic on the code, not the message.**
- `details` is only present when there is something extra to report (e.g. errors per field).
- `requestId` matches the `X-Request-Id` response header and the server log lines for that request.

### Request IDs
Every response has an `X-Request-Id` header. You can send your own, e.g. an n8n execution ID
(letters, digits, `-` and `_`, up to 64 characters), and it will be reused for tracing. Otherwise a UUID is generated.

### Limits
- Request bodies over **10 KB** are rejected with `413`.

---

## Endpoints

### `GET /api/health`
**Liveness:** "the server process is running". Never touches storage, so it stays `200` even when Google Sheets is down.
```json
200 { "status": "ok", "store": "sheets", "ai": "gemini-2.5-flash", "uptimeSeconds": 42, "timestamp": "2026-11-05T06:39:40.375Z" }
```
`ai` is the **configured** model, or `"disabled"` when there is no `GEMINI_API_KEY`. It does not test the AI (that would cost quota): use `npm run ai:check` for that. AI is optional, so a broken AI never makes `/health` or `/ready` fail.

### `GET /api/health/ready`
**Readiness:** "the server can do its job right now". Checks that storage is reachable and every tab has the right header row. It reads only the header rows and is never cached.
```json
200 { "status": "ready", "store": "sheets", "timestamp": "2026-11-05T06:39:42.330Z" }
```
| Status | Code | When |
|---|---|---|
| 200 | | Storage OK (always for `memory`) |
| 503 | `STORAGE_UNAVAILABLE` | Google Sheets unreachable, too slow (8 s), credentials rejected, sheet not shared, tab missing, or header wrong. The exact reason is in the server log (`"msg":"storage error"`, field `kind`) |

Monitoring (n8n, Stage 6) should alert when `/ready` fails, and restart the server only when `/health` fails.

### The lead object
| Field | Type | Set by | Meaning |
|---|---|---|---|
| `id` | string | system | `LD-1001`, … |
| `name`, `phone`, `email`, `zip`, `serviceType`, `timeline`, `message` | string | customer | Validated input (see `POST /api/leads`) |
| `source` | string | system | e.g. `Website form` |
| `status` | string | system / staff | **Sales** status: `New`, `Contacted`, `Qualified`, `Won`, `Lost` |
| `createdAt` | ISO date | system | When the lead was received |
| `qualificationStatus` | string | AI flow | **AI** status: `pending` → `qualified` or `failed` |
| `classification` | `Hot` \| `Warm` \| `Cold` \| null | AI | null until qualified |
| `score` | integer 0–100 \| null | AI | Hot 70–100, Warm 40–69, Cold 0–39 |
| `aiReason` | string \| null | AI | One-sentence explanation |
| `aiModel` | string \| null | AI flow | The exact model version that classified the lead, or **`simulated`** for hand-written sample data |
| `qualifiedAt` | ISO date \| null | AI flow | When the AI result was saved |
| `reviewFlags` | string[] | Validation Agent | Stage 5 quality flags, e.g. `["too_vague"]`. Empty = no issues. See [`ai-agents.md`](ai-agents.md) |

A **failed re-qualification keeps the previous** `classification`, `score`, `aiReason` and `aiModel` (only `qualificationStatus` becomes `failed`). Leads created before Stage 4 have empty AI cells: they read as `qualified` + `simulated` if they have a classification (there was no AI before Stage 4), otherwise `pending`.

### `GET /api/leads`
All leads, newest first.
```json
200 { "data": [ { "id": "LD-1001", "name": "Maria Gonzalez", ... } ], "count": 10 }
```

### `GET /api/leads/:id`
One lead. The ID format is `LD-` followed by digits.

| Status | Code | When |
|---|---|---|
| 200 | | Found |
| 400 | `INVALID_LEAD_ID` | ID is not in the `LD-1001` format |
| 404 | `LEAD_NOT_FOUND` | No lead with that ID |

### `POST /api/leads`
Creates a lead from a customer inquiry.

**Request body**
| Field | Type | Rules |
|---|---|---|
| `name` | string | 2–80 characters (trimmed) |
| `phone` | string | US format: `5125550147`, `512-555-0147`, `(512) 555-0147`, `+1 512 555 0147` |
| `email` | string | Valid email (stored lowercase) |
| `zip` | string | `78701` or `78701-1234` |
| `serviceType` | string | One of `Roofing`, `HVAC`, `Plumbing`, `Kitchen Remodel`, `Bathroom Remodel`, `Windows & Doors`, `Siding`, `Solar` |
| `timeline` | string | One of `ASAP`, `Within 1 month`, `1-3 months`, `Just researching` |
| `message` | string | 10–1000 characters |

Any other fields (e.g. `id`, `status`, `classification`, `score`) are **ignored**. The system sets them.

**Example**
```json
POST /api/leads
{
  "name": "Tom Rivera",
  "phone": "512-555-0199",
  "email": "tom.rivera@example.com",
  "zip": "78702",
  "serviceType": "Siding",
  "timeline": "Within 1 month",
  "message": "Need new siding on a two-story house."
}
```
```json
201 Created
Location: /api/leads/LD-1011
{
  "data": {
    "id": "LD-1011", "name": "Tom Rivera", "phone": "512-555-0199",
    "email": "tom.rivera@example.com", "zip": "78702", "serviceType": "Siding",
    "timeline": "Within 1 month", "message": "Need new siding on a two-story house.",
    "source": "Website form", "classification": null, "score": null,
    "status": "New", "createdAt": "2026-11-04T09:21:06.725Z",
    "qualificationStatus": "pending", "aiReason": null, "aiModel": null, "qualifiedAt": null
  }
}
```
A successful create also writes an activity event (lead ID only, no personal data).

**The agents run in the background** after the lead is saved (Stage 5 Orchestrator: Validation Agent → AI qualification → follow-up draft for Hot leads). The response never waits for the AI, and an AI failure never loses the lead. A few seconds later the lead has its `reviewFlags` and becomes `qualified` (or `failed`; or stays `pending` if it was blocked as test/spam or AI is disabled). Poll `GET /api/leads/:id`.

| Status | Code | When | Retry? |
|---|---|---|---|
| 201 | | Created | |
| 400 | `VALIDATION_ERROR` | Body missing, not an object, or fields invalid (`details` lists each field) | **No.** Permanent: fix the input |
| 400 | `INVALID_JSON` | Body is not valid JSON | No |
| 409 | `DUPLICATE_LEAD` | Same email (any letter case) or same phone (any format) already exists. The matching lead is deliberately not revealed | No |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 10 KB | No |
| 500 | `INTERNAL_ERROR` | Unexpected server error. Details are only in the server log, found by `requestId` | Yes, with backoff (Stage 7) |
| 503 | `STORAGE_UNAVAILABLE` | Storage could not be read or written. **The lead may or may not have been saved** (see limitations) | Only after checking whether the lead exists (Stage 7) |

### `POST /api/leads/:id/qualify`
(Re)runs AI qualification for one lead, e.g. after a failure, or to replace a `simulated` classification. No request body.
The lead is marked `pending` and the AI runs **in the background** (so this request stays well inside the frontend's 10 s budget). The result appears on the lead a few seconds later. Calling it again while it runs starts nothing new.
```json
202 Accepted
{ "data": { "id": "LD-1005", "qualificationStatus": "pending", "classification": "Cold", ... } }
```
| Status | Code | When |
|---|---|---|
| 202 | | Started (or already running) |
| 400 | `INVALID_LEAD_ID` | Malformed ID |
| 404 | `LEAD_NOT_FOUND` | No lead with that ID |
| 503 | `AI_UNAVAILABLE` | AI is not configured on this server (no `GEMINI_API_KEY`). Nothing changed |
| 503 | `STORAGE_UNAVAILABLE` | Storage problem |

Each AI run writes an activity event: `ai` (`LD-1005 classified as Cold (score 25) by gemini-2.5-flash`) or `error` (`AI qualification failed for LD-1005: … (temporary, can be retried)`). A suspected prompt injection adds an `error` event: `Possible prompt injection in LD-…`.

### Follow-up drafts (Stage 5)
The AI writes **drafts only**; a person approves, edits or rejects them. **Nothing is sent by this API** (approved drafts are sent by n8n in Stage 6).

**Follow-up object:** `id` (`FU-...`), `leadId`, `channel` (`email`), `subject`, `body`, `status` (`draft` | `approved` | `rejected`), `aiModel`, `createdAt`, `decidedAt`, `editedAt`.

#### `GET /api/leads/:id/followups`
The lead's follow-ups, newest first. `200 { "data": [ ... ], "count": 1 }`. Errors: `400 INVALID_LEAD_ID`, `404 LEAD_NOT_FOUND`.

#### `POST /api/leads/:id/followups`
Asks the Follow-up Agent for a draft. It is written **in the background**, so poll the GET above.
```json
202 Accepted
{ "data": { "leadId": "LD-1001", "status": "generating" } }
```
If the lead already has an open `draft`, no new draft is written (the agent run is recorded as `skipped`). Errors: `400 INVALID_LEAD_ID`, `404 LEAD_NOT_FOUND`, `503 AI_UNAVAILABLE` (no AI key). AI failures and unsafe drafts (prices, promises, placeholders…) are recorded in AgentRuns, and no draft is saved.

#### `POST /api/followups/:id/approve` · `POST /api/followups/:id/reject`
A person's decision. `200 { "data": { ...followUp, "status": "approved", "decidedAt": "..." } }`. Writes an activity event (`… approved by staff (not sent: sending arrives in Stage 6)`).

#### `PATCH /api/followups/:id`
A person edits a draft. Body: `{ "subject": "5-80 chars", "body": "20-2000 chars" }`. The result stays a `draft` with `editedAt` set. Only shape and length are checked: the AI's content rules don't apply to a person's own words.

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_FOLLOWUP_ID` | ID is not in the `FU-...` format |
| 400 | `VALIDATION_ERROR` | Edit: subject or body too short or long (`details` per field) |
| 404 | `FOLLOWUP_NOT_FOUND` | No follow-up with that ID |
| 409 | `FOLLOWUP_ALREADY_DECIDED` | It is already approved or rejected and can no longer change |

### `GET /api/agent-runs`
The audit trail of agent runs (Stage 5), newest first. Never contains personal data.
```json
200 { "data": [ { "runId": "AR-...", "leadId": "LD-1013", "agent": "orchestrator", "status": "success", "durationMs": 11785, "errorKind": null, "detail": "validation: ok → qualification: Hot 95 → followup: draft FU-...", "startedAt": "..." } ], "count": 7 }
```
`agent`: `orchestrator`, `validation`, `qualification`, `followup`. `status`: `success`, `skipped`, `failed`, `denied` (an agent tried to use a tool it may not use).

### `GET /api/activity`
Activity and audit events, newest first. `type` is one of `lead`, `ai`, `automation`, `error`, `recovery` or `escalation`.
```json
200 { "data": [ { "id": "EV-5014", "type": "automation", "message": "...", "leadId": "LD-1001", "timestamp": "..." } ], "count": 8 }
```

### `GET /api/workflow-runs`
Automation workflow runs, newest first. **Simulated sample data** until n8n is connected (Stage 6).
`status` is one of `success`, `retrying`, `failed` or `escalated`.
```json
200 { "data": [ { "id": "WF-9031", "workflow": "AI qualification", "status": "success", "attempts": 1, "maxAttempts": 3, "lastError": null, ... } ], "count": 8 }
```

### Any other route
`404 NOT_FOUND`

---

## Error code reference
| Code | Status | Permanent? | Meaning |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Yes | Input is missing or invalid |
| `INVALID_JSON` | 400 | Yes | Body could not be parsed |
| `INVALID_LEAD_ID` | 400 | Yes | Malformed lead ID |
| `NOT_FOUND` | 404 | Yes | Unknown route |
| `LEAD_NOT_FOUND` | 404 | Yes | Lead does not exist |
| `INVALID_FOLLOWUP_ID` | 400 | Yes | Malformed follow-up ID |
| `FOLLOWUP_NOT_FOUND` | 404 | Yes | Follow-up does not exist |
| `FOLLOWUP_ALREADY_DECIDED` | 409 | Yes | Follow-up already approved or rejected |
| `DUPLICATE_LEAD` | 409 | Yes | Lead already exists |
| `PAYLOAD_TOO_LARGE` | 413 | Yes | Body too large |
| `INTERNAL_ERROR` | 500 | No (may be temporary) | Unexpected server error |
| `AI_UNAVAILABLE` | 503 | Depends | AI not configured (permanent until a key is added), or an AI run failed. The background failure reason is in the log and activity (`kind`: `timeout`, `rate_limited`, `quota_exhausted`, `unavailable`, `invalid_output` are temporary; `auth`, `api_disabled`, `permission`, `model_not_found`, `blocked`, `bad_request` need a human) |
| `STORAGE_UNAVAILABLE` | 503 | No (often temporary) | Storage (Google Sheets) unreachable, slow or misconfigured. The log `kind` says which: `timeout`, `rate_limited`, `unavailable` (temporary) or `auth`, `api_disabled`, `permission`, `not_found`, `missing_tab`, `bad_format` (need a human) |

"Permanent" means sending the same request again will fail the same way. Only non-permanent errors should ever be retried.

## Known limitations (Stage 5)
- Follow-up drafts are never sent by this API (Stage 6). Decisions are not tied to a user (no login until Stage 8).
- **AI free tier: 20 requests per day** for `gemini-2.5-flash` (verified from Google's own 429 response on 2026-11-05). After that, AI runs fail with `quota_exhausted` until the daily reset. Real use needs a paid tier (rotate the exposed key first).
- AI results are not always right: see the measured accuracy in [`ai-qualification.md`](ai-qualification.md).
- No automatic AI retries yet: a failed lead stays `failed` until someone clicks Retry (Stage 7).
- If the server stops while an AI run is in progress, the lead stays `pending` (Stage 7 will find and retry such leads).
- No authentication or rate limiting yet (Stage 8).
- **Partial writes (Google Sheets):** creating a lead writes two rows, the lead and then its activity event. Sheets has no transactions. If the second write fails, the client gets `503`, but the lead **is saved**, so retrying the same request returns `409 DUPLICATE_LEAD`. A write that times out may also have been saved. Stage 7 adds idempotency keys and recovery for this.
- **Duplicate race:** the duplicate check is check-then-insert. It held in memory (5 identical concurrent requests → 1 lead, 4 × `409`), but with Google Sheets two simultaneous identical requests could both pass. Stage 7 adds proper duplicate-request protection.
- **Cache:** reads are cached for 10 s, so hand edits in the sheet appear in the API within ~10 s.
- **Rows broken by hand** (e.g. text in `score`) are skipped and logged as warnings, not returned.
- **Scale:** every uncached read loads a whole tab. That is fine for hundreds of leads, not for many thousands.
