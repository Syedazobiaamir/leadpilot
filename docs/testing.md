# Testing

How the project is tested, how to run the tests, and what is NOT covered. Rules for writing tests:
`.claude/skills/testing-qa/SKILL.md`.

## Layers
| Layer | Tool | Where | Count (2026-11-14) |
|---|---|---|---|
| Backend unit + API tests | Vitest + Supertest | `backend/tests/` (29 files) | **584** |
| Frontend unit + component tests | Vitest + React Testing Library (fake API) | `frontend/src/**/*.test.*` (9 files) | **102** |
| Lint + production build | oxlint, Vite | `frontend/` | must pass |
| Smoke test (end to end, real HTTP) | `backend/scripts/smoke.js` | local or a deployment | **36 checks** |
| Security drills (live) | script, see `docs/security.md` | isolated backend or a preview deployment | 14 local / 16 on Vercel |
| AI evaluations (real Gemini) | `npm run ai:eval`, `npm run ai:eval-followup` | `backend/evals/` | 16/16 qualification, 8/8 follow-up |
| Failure drills | real server on a spare port with broken settings | `docs/self-healing.md`, `docs/ai-qualification.md`, `backend/README.md` | per stage |

## Run them
```bash
cd backend  && npm test                    # no network, no Google account, AI always off
cd frontend && npm test && npm run lint && npm run build
cd backend  && npm run smoke               # both local servers running (logs in: STAFF_PASSWORD or a prompt)
cd backend  && npm run smoke -- https://<a preview deployment>   # see docs/deployment.md
```
⚠️ The smoke test CREATES a test lead. Never run it against the live site (it uses the real Google Sheet):
use local servers (memory store) or a Vercel **preview** deployment (memory store).

## What makes the tests trustworthy
- **Safety by configuration:** in tests the store is always `memory`, AI and n8n are always off (`config.js`),
  so no test can touch the real sheet or spend the AI quota.
- **Contracts:** both stores run the same 10-rule contract (`tests/storeContract.js`); the two copies of the lead
  schema must be identical (`tests/schemaSync.test.js`).
- **Real login in every test:** `tests/setup.js` logs in through the real login; `tests/auth.test.js` reads the
  route files and checks every non-public route is locked.
- **Fakes for outside services:** fake Google Sheets (`fakeSheetsClient.js`), fake Gemini (`fakeGeminiClient.js`),
  fake API in the frontend (`src/test/fakeApi.js`).
- **Mutation checks:** when a new test passes at once, the protected code is broken on purpose to see the test fail
  (e.g. removing `keepAlive`, a lock, the honeypot, the rate limit, a security header). Misses led to better tests.
- **Deployment config tests:** `tests/deployment.test.js` checks `waitUntil` is used for background work, the Vercel
  entry point, `vercel.json` rules (rewrites, CSP without `unsafe-inline`), `.vercelignore`, and the n8n workflow
  address converter.

## Live verification (Stage 9)
See `docs/deployment.md` → *Verified*: production read-only checks, preview smoke 36/36, preview security drills
15/16 (the 1 explained), n8n → live site runs succeeded.

## Not covered
- Visual layout and real-browser behaviour (no browser automation; checked by hand by the developer).
- Load and performance (Sheets allows ~60 reads/minute; serverless instances keep separate in-memory limits).
- On production: a real Hot lead end-to-end (background AI via `waitUntil` + the n8n alert) and an approved
  follow-up, at the time of writing.
- Real email delivery (it is SIMULATED by design).
