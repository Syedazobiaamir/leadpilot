---
name: api-integration
description: Rules for connecting the backend to external services (Google Sheets now; Gemini, n8n webhooks, Slack later): client wrappers, error translation, timeouts, secrets, readiness checks, fakes for tests, setup scripts and failure drills. Use whenever adding, changing or debugging an integration with a third-party API.
---

# External API integrations

The reference implementation is the Google Sheets store (Stage 3):
`backend/services/stores/sheetsClient.js` → `sheetsStore.js` → `sheetsMapper.js`, plus `scripts/sheetsAdmin.js`.
Follow the same shape for every new integration.

## Before writing code
- **Never assume an integration is connected.** Check that its settings exist and work (a `*:check` script) before relying on it.
- New SDK or package? Explain why it's needed and get approval first. Prefer the provider's official, smallest package (e.g. `@googleapis/sheets`, not all of `googleapis`).
- Inspect the real SDK (methods, error shapes) with a quick local script. Don't guess.

## Structure
| Layer | Rule |
|---|---|
| **Client** (`*Client.js`) | The ONLY file that imports the SDK or calls the service. Small methods (`readTab`, `appendRow`, …). Accepts an injectable fake (`api`) for tests |
| **Store / service adapter** | Uses the client and turns failures into `AppError` (e.g. `503 STORAGE_UNAVAILABLE`). Logs the real reason |
| **Mapper** | Pure conversion between the external format and our objects. Fully unit-tested |

## Errors
- Translate every SDK/network error into ONE error type with a `kind` and a `temporary` flag (see `StorageError` / `describeGoogleError`).
  - temporary: `timeout`, `rate_limited`, `unavailable` → may be retried later (Stage 7, with backoff)
  - needs a human: `auth`, `permission`, `not_found`, `api_disabled`, `missing_tab`, `bad_format`
- **Discard the original SDK error.** It often contains request config, including `Authorization` tokens. Keep only the HTTP status and error code.
- The client gets a generic, honest message (`503`). The log gets `kind`, `reason`, `temporary`, status and code.
- Never report success unless the external call succeeded. If a write might have happened (timeout), say so in the docs and clear any cache.

## Timeouts
- Wrap EVERY external call in our own deadline (`Promise.race` with a timer). SDK timeouts may not cover every phase (Google's didn't cover getting the OAuth token).
- **Timeout budget:** inner timeouts must be shorter than outer ones (backend → Google 8 s < frontend → backend 10 s).

## Configuration & secrets
- Read settings only in `config.js`. Validate them at startup and list **every** problem at once. Never include a secret's value in a message.
- With a misconfigured integration the server refuses to start (or, for a reachable-but-broken service, starts and reports not-ready). It **never silently falls back** to fake or sample data.
- Secrets go in `backend/.env` only, and `.env.example` gets a placeholder. Key files stay outside the project, and `.gitignore` blocks common key file names.
- Make sure the logger redacts the new secret's field names, and add a test for it.
- Never ask the developer to paste a secret into chat. If one is exposed, recommend rotating it (delete + create new). See the open TODO in `CLAUDE.md`.

## Health
- `/api/health` = liveness (never calls external services). `/api/health/ready` = can we use our dependencies right now (cheap, uncached checks).
- Check the connection once at startup and log a clear OK / NOT ready line.

## Rate limits & caching
- Know the provider's limits. Cache reads briefly, share in-flight requests, clear the cache on writes, never cache failures.

## Tests
- **No network in automated tests.** Use a fake that mimics the provider's real quirks (e.g. `tests/fakeSheetsClient.js`: RAW storage, trimmed rows, missing tabs, `failNext(kind)`).
- If the integration replaces a store, run the shared contract (`tests/storeContract.js`) against it.
- Test the error translation table, the deadline (a promise that never settles), and that secrets/tokens never reach errors or logs.
- `config.js` forces `DATA_STORE=memory` in tests, so tests can never write to a real external resource.

## Setup & diagnostic scripts
- Provide `npm run <service>:check` (read-only, step-by-step, a **Fix:** line per failure) and, if needed, `<service>:setup`.
- Setup must be **idempotent** and must **never delete or overwrite** existing data. Report unexpected structures instead of "fixing" them.

## Live verification (after the developer connects real credentials)
1. `*:check` passes.
2. Smoke test passes against the real service. Note that it creates demo data.
3. Restart test: data persists.
4. **Failure drills** on a separate port with overridden env vars (don't touch `.env`): wrong ID, wrong credentials, unreachable (`HTTPS_PROXY` to a closed port), never-answering (proxy that accepts and hangs). Plus reversible hand edits (broken row, renamed tab), always restored afterwards. Each must give a clear error, a precise log `kind`, no crash, and no secrets in the log.
