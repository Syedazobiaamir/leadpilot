# LeadPilot: Backend API (Stage 5)

Node.js + Express REST API for the AI Lead Management & Self-Healing Automation Platform.

> **Stage 5 status:** data is stored in **Google Sheets** (persistent) or **in memory** (simulated sample
> data, resets on restart). For every new lead an **Orchestrator** runs the AI agents in the background:
> Validation Agent (rules) → Qualification Agent (Gemini) → Follow-up Agent (email DRAFT for Hot leads,
> approved by a person). Nothing is sent yet: n8n arrives in Stage 6.

- Endpoint reference: [`docs/api-documentation.md`](../docs/api-documentation.md)
- Google Sheets setup: [`docs/google-sheets-setup.md`](../docs/google-sheets-setup.md)
- AI qualification design, evaluation and drills: [`docs/ai-qualification.md`](../docs/ai-qualification.md)
- AI agents (permissions, Orchestrator, follow-ups, drills): [`docs/ai-agents.md`](../docs/ai-agents.md)

## Run it

Requires Node.js 22+ (developed on v24).

```bash
cd backend
npm install        # first time only
npm run dev        # http://localhost:3001, restarts when you save a file
```

Settings live in `backend/.env` (copy `.env.example`). `.env` is never committed.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Port to listen on (the frontend proxy expects 3001) |
| `NODE_ENV` | `development` | `development`, `production` or `test` |
| `LOG_LEVEL` | `info` (`silent` in tests) | `debug`, `info`, `warn`, `error` or `silent` |
| `DATA_STORE` | `memory` | `memory` (sample data, resets on restart) or `sheets` (Google Sheets). **Tests always use `memory`.** |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | | Only for `sheets`. The ID from the sheet URL (the whole URL also works) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | | Only for `sheets`. `client_email` from the JSON key |
| `GOOGLE_PRIVATE_KEY` | | Only for `sheets`. `private_key` from the JSON key, one line, in quotes. **Secret** |
| `GEMINI_API_KEY` | (empty = AI off) | Key from Google AI Studio. **Secret.** Without it, leads stay `pending` and the server still runs. **Tests always have AI off.** |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Optional model override. `npm run ai:check` checks it |
| `CONTRACTOR_NAME` | `LeadPilot Demo Contracting` (fictional) | Business name that signs AI follow-up drafts |
| `AUTOMATION_SECRET` | (empty = automation off) | Shared secret with n8n, at least 32 characters. **Secret.** n8n sends it as `x-automation-key`; the backend sends it to n8n the same way. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Tests always have automation off.** |
| `N8N_WEBHOOK_BASE_URL` | (empty = no events sent) | Where n8n's Webhook nodes listen, e.g. `http://localhost:5678/webhook`. Needs `AUTOMATION_SECRET` |
| `STAFF_PASSWORD_HASH` | (empty = staff routes closed, 503) | Stage 8: scrypt hash of the staff password. Written by `npm run auth:set-password`. **Secret** |
| `SESSION_SECRET` | (empty) | Stage 8: signs login cookies (≥ 32 random characters). Written by the same script. **Secret**; change it to end all sessions |
| `TRUST_PROXY` | (empty) | Stage 8: number of proxies in front of the server (`1` on Vercel), so rate limits see the real visitor IP. Empty locally |

With `DATA_STORE=sheets` and a missing or malformed Google setting, the server **refuses to start** and lists every problem.

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-restart on file changes |
| `npm start` | Start normally |
| `npm test` | Run all tests (no network, no Google account needed) |
| `npm run smoke` | End-to-end check against the running app (see below) |
| `npm run sheets:check` | Diagnose the Google Sheets connection step by step. **Read-only** |
| `npm run sheets:setup` | Create missing tabs and header rows, and add columns from newer versions to the end of the header. `-- --seed` adds SIMULATED sample data to empty tabs. Never deletes or overwrites |
| `npm run ai:check` | Check the Gemini key, the model, and one real test classification (2 requests) |
| `npm run ai:eval` | Run the AI evaluation set (~16 requests). Results go to `evals/last-run.json` |
| `npm run ai:eval-followup` | Run the follow-up draft evaluation (~8 requests). Results go to `evals/followup-last-run.json` |

## How a request flows

```
request → requestId → requestLogger → express.json (10 KB limit)
        → route → controller → service → leadStore ─┬─ stores/memoryStore
                                                     └─ stores/sheetsStore → sheetsMapper (rows ⇄ objects)
                                                                           → sheetsClient (the only code that calls Google)
        → (if anything throws) notFound / errorHandler → JSON error response
```

| Folder / file | Job |
|---|---|
| `routes/` | Map URL + method to a controller |
| `controllers/` | Read the request, call a service, send the response. No business rules |
| `services/leadService.js`, `monitoringService.js` | Business rules |
| `agents/` | Stage 5: tool registry + permissions, `runAgent` (AgentRuns records), Validation / Qualification / Follow-up agents, Orchestrator |
| `services/qualificationService.js` | Runs the Qualification Agent (background jobs, retry endpoint) |
| `services/followUpService.js` | Follow-up drafts: background requests + human approve / reject / edit |
| `services/ai/geminiClient.js` | The only code that calls Gemini: plain `fetch`, key in a header, own deadline, `AiError` kinds |
| `services/ai/qualificationPrompt.js` | Instructions, prompt (service + timeline + message only), response schema, Zod check, settings |
| `evals/` | AI evaluation cases and results |
| `services/leadStore.js` | Picks the store from `DATA_STORE`. The services only ever talk to this |
| `services/stores/memoryStore.js` | In-memory store |
| `services/stores/sheetsStore.js` | Google Sheets store: cache, broken-row handling, every failure → `503` |
| `services/stores/sheetsMapper.js` | Pure row ⇄ object conversion: tab layouts (`TABLES`), types, columns found by name |
| `services/stores/sheetsClient.js` | Wraps `@googleapis/sheets`: RAW writes, deadline, error translation |
| `middleware/` | Request IDs, logging, 404 handling and error formatting |
| `validation/` | `leadSchema.js` (Zod), an **identical copy** of the frontend's schema |
| `utils/` | `AppError` (errors with status and code), structured JSON `logger` with redaction |
| `data/` | Simulated seed data |
| `tests/` | Unit, contract and Supertest tests, plus fakes (`fakeSheetsClient.js`) |
| `scripts/` | `smoke.js`, `sheets.js` + `sheetsAdmin.js` (sheets:check / sheets:setup) |

## Design decisions
- **`app.js` is separate from `server.js`**, so tests can call the app without opening a port.
- **Swappable stores with one contract.** `tests/storeContract.js` holds 10 rules (types survive, formulas stay text, copies returned, …). The memory store and the Sheets store both run the same contract, which is how we know they're interchangeable.
- **The store returns copies**, so callers can't change stored data by accident. This includes cached data.
- **One error format** with stable `code`s, which decide whether an error is permanent (never retry) or temporary.
- **Every storage failure becomes `503 STORAGE_UNAVAILABLE`.** The client gets a safe, generic message. The log gets the exact `kind` (`auth`, `permission`, `not_found`, `missing_tab`, `bad_format`, `timeout`, `rate_limited`, `unavailable`) and whether it is temporary.
- **Formula injection is blocked** by writing with `valueInputOption: RAW`, so `=HYPERLINK(...)` typed by a "customer" stays plain text.
- **Columns are found by header name**, not position: reordering columns or adding extra ones is safe. A row broken by hand is **skipped and logged** (with its row number, no personal data) instead of breaking the whole list.
- **10 s read cache** (Google allows ~60 reads/min). Requests arriving at the same moment share one Google read, a write clears the cache, and failures are never cached.
- **Our own deadline on every Google call.** The library's timeout doesn't cover getting the login token; a failure drill showed a hung network could block requests for 30+ s.
- **Timeout budget:** the backend gives up on Google after **8 s**, before the frontend's **10 s**, so the clear `503` reaches the browser.
- **Liveness vs readiness:** `/api/health` = process alive. `/api/health/ready` = storage usable.
- **Secrets stay out of logs:** Google's original errors are discarded, because they contain the `Authorization` access token. Only the status and code are kept. The logger redacts `password`, `token`, `apiKey`, `privateKey`, `credentials`, … at any depth.
- **The validation schema is shared by copying it** (option A), and `tests/schemaSync.test.js` fails if the two copies differ. **Always edit both files.**
- **Few dependencies:** `express`, `zod`, `@googleapis/sheets` (Google's official Sheets-only package). Node's built-in `--env-file-if-exists` and `--watch` replace `dotenv` and `nodemon`.

## Verification done in Stage 3
- 155 automated tests, including the store contract for both stores and a fake Google spreadsheet that mimics Google's behaviour (RAW storage, trimmed rows, missing tabs).
- Live run against a real Google Sheet: `sheets:check`, `sheets:setup --seed` (run twice, the second run changed nothing), smoke test 24/24, and **data survived a server restart**.
- Failure drills against the real setup: wrong spreadsheet ID, wrong service account, Google unreachable, Google never answering (found and fixed the deadline bug), a row broken by hand, and a renamed tab. Each one gave a `503` (or a skipped row), a precise log reason, no crash, and no secrets in the log.

## Smoke test
With the backend **and** the frontend dev server running:
```bash
npm run smoke                            # through the Vite proxy, like the browser
npm run smoke -- http://localhost:3001   # straight to the API
```
It checks 23 behaviours (24 through the proxy, including the app page) and exits with code `1` if anything fails or a server isn't running.
⚠ Each run **creates one test lead** (named "Smoke Test"). With `DATA_STORE=sheets` that lead is written to the real spreadsheet. Only use it on demo data, and delete the row afterwards if you like.

## Known limitations
- **AI:** the Gemini free tier allows **20 requests/day** (gemini-2.5-flash). After that, AI runs fail with `quota_exhausted`. Automatic AI retries (Stage 7) are capped at 3 per sweep and 5 per day. See `docs/ai-qualification.md` and `docs/self-healing.md`.
- **Partial writes:** Sheets has no transactions. A lead saved without its activity row still returns `201` (the gap is logged). A lead write that timed out may have been saved: the form's retry with the same `Idempotency-Key` returns it instead of a duplicate.
- **Duplicate protection is in-process:** creates run one at a time inside ONE server process. Several instances (serverless, i.e. the live Vercel site) would need a database-level lock.
- **Scale:** each uncached read loads a whole tab. That is fine for hundreds of leads, slow for many thousands.
- A temporary Google error still returns `503` to the caller right away; the self-healing (Stage 7) retries background work (AI, n8n hand-offs), not the caller's request. `/api/health/ready` reads 7 tabs per call: don't poll it fast (60 reads/minute limit).
- Storage error log lines don't include the `requestId`. Match them by time with the `request failed` line (to improve in Stage 8).
- No authentication, rate limiting or security headers yet (Stage 8).
- No CORS setup: in development the Vite proxy makes it unnecessary; on Vercel the page and the API share one domain (`docs/deployment.md`).
- Workflow runs are simulated sample data (Stage 6: n8n).

## Stage 8 scripts
| Command | What it does |
|---|---|
| `npm run auth:set-password` | Asks for the staff password twice (hidden) and writes its hash + a session secret to `.env`. Run it in your own terminal |
| `npm run keys:import-google -- "<key.json>"` | Writes a NEW Google service-account key into `.env` (refuses the old exposed key) |
| `npm run keys:set-gemini` | Asks for a NEW Gemini key (hidden) and writes it into `.env` |
| `npm run smoke` | Now logs in: set `STAFF_PASSWORD` (or type it when asked). Sends ~9 form POSTs: wait a minute between runs (rate limit) |

## Stage 9: on Vercel
The same app runs as one Vercel function (`../api/index.js`). Background work (AI, follow-ups, n8n events) goes
through `utils/background.js` → `keepAlive()` (Vercel's `waitUntil`; does nothing locally). Settings, deploying and
the n8n tunnel: [`docs/deployment.md`](../docs/deployment.md). Local development uses `DATA_STORE=memory`: the
Google Sheet is now the LIVE database, so never run the smoke test against it.
