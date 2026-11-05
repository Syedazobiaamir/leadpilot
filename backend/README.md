# LeadPilot: Backend API (Stage 3)

Node.js + Express REST API for the AI Lead Management & Self-Healing Automation Platform.

> **Stage 3 status:** data can be stored in **Google Sheets** (persistent) or **in memory** (simulated
> sample data, resets on restart). Gemini and n8n are not connected yet.

- Endpoint reference: [`docs/api-documentation.md`](../docs/api-documentation.md)
- Google Sheets setup: [`docs/google-sheets-setup.md`](../docs/google-sheets-setup.md)

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

With `DATA_STORE=sheets` and a missing or malformed Google setting, the server **refuses to start** and lists every problem.

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-restart on file changes |
| `npm start` | Start normally |
| `npm test` | Run all tests (no network, no Google account needed) |
| `npm run smoke` | End-to-end check against the running app (see below) |
| `npm run sheets:check` | Diagnose the Google Sheets connection step by step. **Read-only** |
| `npm run sheets:setup` | Create missing tabs and header rows. `-- --seed` adds SIMULATED sample data to empty tabs. Never deletes or overwrites |

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
- **Partial writes:** creating a lead writes the lead row, then its activity row. Sheets has no transactions. If the second write fails, the client sees `503` although the lead was saved. A write that times out may also have been saved. Stage 7 adds idempotency keys and recovery.
- **Duplicate race:** the duplicate check is check-then-insert. With Google Sheets, two simultaneous identical requests could both pass (Stage 7).
- **Scale:** each uncached read loads a whole tab. That is fine for hundreds of leads, slow for many thousands.
- No automatic retries yet: temporary Google errors return `503` immediately (Stage 7).
- Storage error log lines don't include the `requestId`. Match them by time with the `request failed` line (to improve in Stage 8).
- No authentication, rate limiting or security headers yet (Stage 8).
- No CORS setup: in development the Vite proxy makes it unnecessary. Deployment is decided in Stage 9.
- Workflow runs are simulated sample data (Stage 6: n8n).
