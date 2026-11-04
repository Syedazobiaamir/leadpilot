# API Documentation

REST API served by the Express backend (`backend/`).

- **Base URL (development):** `http://localhost:3001/api`, or `http://localhost:5173/api` through the Vite proxy
- **Format:** JSON requests and responses (`Content-Type: application/json`)
- **Authentication:** none yet (planned before deployment)
- **Data:** Stage 2 uses an **in-memory store seeded with simulated sample data**. It resets on every server restart.

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
Liveness check for monitoring.
```json
200 { "status": "ok", "uptimeSeconds": 42, "timestamp": "2026-11-04T08:42:57.171Z" }
```

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
    "status": "New", "createdAt": "2026-11-04T09:21:06.725Z"
  }
}
```
A successful create also writes an activity event (lead ID only, no personal data).

| Status | Code | When | Retry? |
|---|---|---|---|
| 201 | | Created | |
| 400 | `VALIDATION_ERROR` | Body missing, not an object, or fields invalid (`details` lists each field) | **No.** Permanent: fix the input |
| 400 | `INVALID_JSON` | Body is not valid JSON | No |
| 409 | `DUPLICATE_LEAD` | Same email (any letter case) or same phone (any format) already exists. The matching lead is deliberately not revealed | No |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 10 KB | No |
| 500 | `INTERNAL_ERROR` | Unexpected server error. Details are only in the server log, found by `requestId` | Yes, with backoff (Stage 7) |

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
| `DUPLICATE_LEAD` | 409 | Yes | Lead already exists |
| `PAYLOAD_TOO_LARGE` | 413 | Yes | Body too large |
| `INTERNAL_ERROR` | 500 | No (may be temporary) | Unexpected server error |

"Permanent" means sending the same request again will fail the same way. Only non-permanent errors should ever be retried.

## Known limitations (Stage 2)
- Data is in memory and resets on restart. Google Sheets arrives in Stage 3.
- No authentication or rate limiting yet (Stage 8).
- The duplicate check is safe today (verified: 5 identical concurrent requests produced 1 lead and 4 × `409`), but it is a check-then-insert. Once storage is a network call (Google Sheets), simultaneous identical requests could both pass. Stage 7 adds proper duplicate-request protection.
