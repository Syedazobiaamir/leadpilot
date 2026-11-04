# LeadPilot: Frontend

The React dashboard for the AI Lead Management & Self-Healing Automation Platform.

> **Stage 2 status:** the UI loads and saves data through the Express API (`backend/`).
> The data is still **simulated sample data held in the server's memory**.
> No AI (Gemini), database (Google Sheets) or automation (n8n) is connected yet.

## Run it

The frontend needs the backend running. Use two terminals:

```bash
# Terminal 1: API
cd backend
npm install      # first time only
npm run dev      # http://localhost:3001

# Terminal 2: frontend
cd frontend
npm install      # first time only
npm run dev      # http://localhost:5173  ← open this one
```

In development, Vite **proxies** every `/api/...` request to `http://localhost:3001` (see `vite.config.js`).
The browser only talks to port 5173, so no CORS setup is needed.
`VITE_API_URL` can override the API address, e.g. for deployment in Stage 9.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` | Runs all Vitest tests once (no backend needed: they use a fake API) |
| `npm run test:watch` | Re-runs tests when files change |
| `npm run lint` | Checks the code for common mistakes (oxlint) |
| `npm run build` | Builds the production version into `dist/` |

## Features

| Feature | Status |
|---|---|
| Dashboard metrics (totals, Hot/Warm/Cold, conversion rate, workflows needing attention) | Working, on sample data from the API |
| Lead capture form with validation (Zod, checked in the browser **and** on the server) | Working |
| Duplicate lead protection (same email or phone) | Working, enforced by the server |
| Lead table with search, classification and status filters | Working |
| Lead detail panel | Working |
| Clear errors when the server is down, slow (10s timeout) or failing, with a *Try again* button | Working |
| Hot/Warm/Cold classification | **Simulated.** The values are hand-written. Gemini arrives in Stage 4 |
| Automation monitoring (success / retrying / failed / escalated) | **Simulated** runs. n8n arrives in Stage 6 |
| Activity & audit log | Sample events, plus real events for leads you create |

## Folder structure

```
src/
  components/   UI only (layout, leads, dashboard, monitoring)
  hooks/        useLeads, useMonitoring: loading / error / data state
  services/     leadService.js: the ONLY file that calls the API (fetch + error handling)
  validation/   leadSchema.js: Zod rules. IDENTICAL copy in backend/validation/. Edit both!
  utils/        pure functions: stats, filters, formatters
  test/         test setup, fakeApi.js (fake backend), fixtures/ (SIMULATED sample data)
```

## How errors reach the user
`leadService.js` turns every failure into an `ApiError` with a code:

| Situation | Code | User sees |
|---|---|---|
| Server not reachable | `NETWORK_ERROR` / `BAD_GATEWAY` | "Could not reach the server…" with *Try again* |
| No answer within 10s | `TIMEOUT` | "The server took too long to respond…" |
| Invalid form fields (server check) | `VALIDATION_ERROR` | Message under each field |
| Duplicate lead | `DUPLICATE_LEAD` | Message above the form |
| Server bug | `INTERNAL_ERROR` | Generic message + short reference ID for the logs |

A failure is never shown as success, and a failed load never shows as an empty dashboard.

## Known limitations
- **No persistence:** data lives in the server's memory and resets when the backend restarts (Stage 3).
- **AI classification is not real:** new leads stay "Pending" until Stage 4.
- **Monitoring data is static samples.** Nothing is actually being retried.
- **No authentication** yet.
- Dates show in the viewer's local time zone.
- In development, React StrictMode runs effects twice, so each page load sends its GET requests twice. That's expected, and doesn't happen in the production build.

## Manual test checklist
Start both servers first.
1. The yellow "Demo mode" banner is visible on every page.
2. The dashboard shows 10 total leads, 4 Hot, 4 Warm, 2 Cold, and a 20% conversion rate.
3. **New Lead** → click *Save lead* with an empty form → an error appears under each field.
4. Type an invalid ZIP (`9021`) or email (`abc`) → you see a specific message.
5. Fill in valid data → a green "Lead LD-1011 saved…" message appears, and the backend terminal logs `POST /api/leads` with status 201.
6. **Leads** → the new lead is at the top with a "Pending" badge.
7. Submit the same email again → the server's "already exists" error appears.
8. Filter Classification = Hot → 4 rows. Search "roofing" → only roofing leads.
9. Click a customer name → the detail panel opens. *Close* hides it.
10. **Automation** → failed or escalated runs show their last error. The activity log includes your new lead.
11. Narrow the browser window (or use phone view in DevTools) → the layout stacks and nothing overflows.
12. Stop the backend and refresh → "Could not reach the server" with *Try again*. Start it again and click *Try again* → the data is back (your new lead is gone: it was in memory).
