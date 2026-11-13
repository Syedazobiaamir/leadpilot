---
name: testing-qa
description: How to write, run and honestly report tests for this project (Vitest, React Testing Library, Supertest, smoke test). Use when adding features, fixing bugs, or before declaring any feature complete.
---

# Testing & QA

## Tools
- **Vitest** is the test runner in both projects. Frontend config: `frontend/vite.config.js` (`test` section, jsdom). Backend: defaults (Node environment).
- **React Testing Library** with `@testing-library/user-event` tests components the way a user uses them.
- **Supertest** sends HTTP requests to the Express app (`createApp()` from `backend/app.js`) without opening a port.
- **Smoke test** (`backend/scripts/smoke.js`) sends real requests to the running app.

## Commands
| Where | Command | Purpose |
|---|---|---|
| `backend/` | `npm test` | Unit + API tests |
| `frontend/` | `npm test` | Unit + component tests (fake API, no server needed) |
| `frontend/` | `npm run lint` and `npm run build` | Must pass |
| `backend/` | `npm run smoke` | End-to-end through the Vite proxy (both servers running). Logs in (Stage 8: `STAFF_PASSWORD` env var, or a hidden prompt). Creates one lead per run; wait a minute between runs (form rate limit) |

Run the tests with a time limit (e.g. `timeout 120 npx vitest run`) so a hung run is noticed instead of blocking.

## What to test
- **Pure logic** (`validation/`, `utils/`): valid and invalid inputs, edge cases (empty list, divide by zero, bad dates).
- **Backend endpoints**: the success case plus **every** error code the endpoint can return, and that rejected requests don't change any data. Call `resetStore()` in `beforeEach`.
- **Backend safety**: unknown fields are ignored, no personal data in audit events or logs, no internal details in `500` responses.
- **Frontend service** (`leadService.js`): mock `fetch` for success, `400`, `409`, `500`, network failure, timeout, and non-JSON responses.
- **Components**: use `installFakeApi()` from `src/test/fakeApi.js` (and `{ failWith: 'network' }` for server-down). Query by role or label (`getByRole`, `getByLabelText`), not CSS classes. Check that failures are never shown as success or as empty data.
- **Shared schema**: `backend/tests/schemaSync.test.js` must stay green. Edit both copies of `leadSchema.js`.
- **Stores**: every store must pass `backend/tests/storeContract.js` (run it via `runStoreContract(name, makeStore)`).
- **External services**: use fakes (`backend/tests/fakeSheetsClient.js`, with `failNext(kind)` for failures). Tests never touch the network: `config.js` forces the memory store in tests.

## Honesty rules
- Paste the **real** test output. Never summarize results that weren't actually run.
- When a new test passes on the first run, break the code on purpose once to confirm the test can fail, then restore the code. Always back the file up first and check it was restored.
- If a run hangs or gives odd numbers, don't count it as evidence. Re-run it with a time limit and report what happened.
- Never weaken or delete a test just to make it pass. Fix the code, or explain why the test was wrong.
- Write down what is **not** tested (e.g. visual layout, load and performance).

## Failure drills (for anything that talks to an external service)
Run the real server on a spare port (e.g. 3002) with overridden env vars, never editing `.env`: wrong ID, wrong credentials, unreachable network, a network that never answers. Make reversible hand edits too (a broken row, a renamed tab) and always restore them. Expect a clear `503`, a precise log `kind`, no crash, nothing saved, and no secrets in the log. The Stage 3 drills found a real bug (missing deadline), so they are worth running. Details are in the `api-integration` skill.

## Manual end-to-end check
Automated tests don't replace actually using the app. Start both servers, go through the checklist in `frontend/README.md`, run `npm run smoke`, and ask the developer to confirm.

## Logged-in tests (Stage 8)
- Backend: `tests/setup.js` logs every test in through the REAL login and makes supertest send the cookie.
  To test as a visitor: `asVisitor(request(app).get(...))` (from `tests/staffSession.js`). Never add a bypass to the app.
- A new route is automatically checked by `tests/auth.test.js` (it reads the route files): put it on the PUBLIC
  list there only if it must really be public.
- Frontend: `installFakeApi({ session: { loggedIn, configured } })`; logged in by default; `FAKE_STAFF_PASSWORD`.
- Rate limits are 10 000 in tests; lower them on purpose with `useLimitsForTests({ ... })`.
- Risky live drills (password guessing locks login for 15 min) run on an ISOLATED backend
  (`PORT=3002 DATA_STORE=memory GEMINI_API_KEY= N8N_WEBHOOK_BASE_URL= node --env-file=.env server.js`).
- Timing tests need wide margins (a busy full run once made 250 ms vs 300 ms flaky).
