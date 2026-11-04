# LeadPilot: Backend API (Stage 2)

Node.js + Express REST API for the AI Lead Management & Self-Healing Automation Platform.

> **Stage 2 status:** the API works end-to-end with the React frontend. Data is **simulated sample data
> in memory** and resets on every restart. No Google Sheets, Gemini or n8n is connected yet.

Full endpoint reference: [`docs/api-documentation.md`](../docs/api-documentation.md)

## Run it

Requires Node.js 22+ (developed on v24).

```bash
cd backend
npm install        # first time only
npm run dev        # http://localhost:3001, restarts when you save a file
```

Optional: copy `.env.example` to `.env` to change settings. `.env` is never committed.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Port to listen on (the frontend proxy expects 3001) |
| `NODE_ENV` | `development` | `development`, `production` or `test` |
| `LOG_LEVEL` | `info` (`silent` in tests) | `debug`, `info`, `warn`, `error` or `silent` |

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-restart on file changes |
| `npm start` | Start normally |
| `npm test` | Run all Vitest + Supertest tests |
| `npm run smoke` | End-to-end check against the running app (see below) |

## How a request flows

```
request → requestId → requestLogger → express.json (10 KB limit)
        → route → controller → service → store
        → (if anything throws) notFound / errorHandler → JSON error response
```

| Folder | Job |
|---|---|
| `routes/` | Map URL + method to a controller |
| `controllers/` | Read the request, call a service, send the response. No business rules |
| `services/` | Business rules (`leadService`, `monitoringService`) and the data store (`leadStore`, the only file that knows where data lives) |
| `middleware/` | Request IDs, logging, 404 handling and error formatting |
| `validation/` | `leadSchema.js` (Zod), an **identical copy** of the frontend's schema |
| `utils/` | `AppError` (errors with status and code), structured JSON `logger` with redaction |
| `data/` | Simulated seed data |
| `tests/` | Supertest and unit tests |
| `scripts/` | `smoke.js` end-to-end check |

## Design decisions
- **`app.js` is separate from `server.js`**, so tests can call the app without opening a port.
- **Store functions are `async`** although they read from memory, so switching to Google Sheets (Stage 3) only changes `leadStore.js`.
- **The store returns copies**, so callers can't change stored data by accident.
- **One error format** with stable `code`s, which decide whether an error is permanent (never retry) or temporary.
- **Unexpected errors never reach the client**: it gets a generic `500` plus a `requestId`, and the stack trace goes only to the log.
- **Logs are structured JSON**, include the request ID, and never contain request bodies, query strings or sensitive fields (`password`, `token`, `apiKey`, … are redacted).
- **The validation schema is shared by copying it** (option A), and `tests/schemaSync.test.js` fails if the two copies differ. **Always edit both files.**
- **No extra packages** for environment files or auto-restart: Node's built-in `--env-file-if-exists` and `--watch` do the job.

## Smoke test
With the backend **and** the frontend dev server running:
```bash
npm run smoke                            # through the Vite proxy, like the browser
npm run smoke -- http://localhost:3001   # straight to the API
```
It checks 23 behaviours (24 through the proxy, including the app page) and exits with code `1` if anything fails or a server isn't running.
⚠ Each run **creates one test lead**. Only use it on local or demo data.

## Known limitations
- In-memory data resets on restart (Stage 3: Google Sheets).
- No authentication, rate limiting or security headers yet (Stage 8).
- No CORS setup: in development the Vite proxy makes it unnecessary. Deployment is decided in Stage 9.
- The duplicate check is check-then-insert. It's safe in memory (verified with 5 concurrent identical requests: one `201` and four `409`s), but needs proper protection once storage is a network call (Stage 7).
- Workflow runs are simulated sample data (Stage 6: n8n).
