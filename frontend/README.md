# LeadPilot: Frontend

The React dashboard for the AI Lead Management & Self-Healing Automation Platform.

> **Stage 5 status:** the UI loads and saves data through the Express API (`backend/`), shows the
> **Gemini AI** qualification of each lead (or clearly marks it **Simulated**), the Validation Agent's
> **Needs review** flags, the AI **follow-up drafts** with Approve / Edit / Reject, and the real **agent runs**.
> The backend stores it in **Google Sheets** (persistent) or **in memory** (resets on restart), depending on
> `DATA_STORE` in `backend/.env`. The data starts as **simulated sample data**.
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
| Hot/Warm/Cold classification | **Gemini AI** for new leads (when the server has a key). Sample leads are marked **Simulated** |
| AI qualification panel (lead detail) | Shows the AI reason, the source (Gemini model + time, or Simulated), "analyzing" while pending, and *Qualify with AI* / *Re-run AI* / *Retry AI*. A failed re-run keeps and shows the previous result |
| Needs review (Validation Agent) | Badge in the table, and the flags explained in the lead detail ("AI skipped" for blocked leads) |
| Follow-up email panel (lead detail) | The AI draft, marked "not sent · needs approval"; Approve / Edit / Reject; "Draft follow-up with AI". Approved = "not sent yet (Stage 6)" |
| Agent runs (Automation page, dashboard) | Real records of every agent run. The n8n workflow runs are labelled **simulated** |
| Automatic refresh while AI works | The list re-fetches every 3 s while a lead is pending, and stops when the result arrives or after 60 s |
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
- **Persistence depends on the backend:** with `DATA_STORE=sheets` data is kept in Google Sheets; with `memory` it resets when the backend restarts.
- **Storage problems** (Google Sheets down, slow or misconfigured) show as "Lead storage is temporarily unavailable…" with *Try again*. A failed save is never shown as saved.
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
12. Stop the backend and refresh → "Could not reach the server" with *Try again*. Start it again and click *Try again* → the data is back (with `DATA_STORE=sheets` your new lead is still there; with `memory` it is gone).
13. **AI** (needs `GEMINI_API_KEY` and free quota): create a lead with an urgent message → table shows *Pending*, then within a few seconds *Hot* (no refresh needed). Open it → *Gemini AI* + model + reason.
14. Open a sample lead (e.g. Maria Gonzalez) → AI panel shows *Simulated*, "not a real AI result", and *Qualify with AI*.
15. With AI off or quota used up, *Qualify with AI* → a clear message, or *AI failed* + *Retry AI*. A lead that had a result keeps showing it.
16. A lead flagged by the Validation Agent shows *Needs review* in the table, and its flags in the detail.
17. A Hot lead's detail shows the follow-up **draft**. *Edit* → change the subject → *Save draft* (still a draft). *Approve* → "Approved · not sent yet". *Reject* on another → "Rejected" + *Draft a new follow-up with AI*.
18. *Automation* → *Agent runs* lists orchestrator / validation / qualification / followup runs; *Workflow runs (simulated)* is labelled as sample data.
