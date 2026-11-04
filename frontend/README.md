# LeadPilot: Frontend (Stage 1)

The React dashboard for the AI Lead Management & Self-Healing Automation Platform.

> **Stage 1 status:** the UI is complete and runs on **simulated sample data**.
> No AI (Gemini), database (Google Sheets), automation (n8n) or external API is connected yet.

## Run it

```bash
cd frontend
npm install      # first time only: downloads dependencies
npm run dev      # starts the dev server at http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` | Runs all Vitest tests once |
| `npm run test:watch` | Re-runs tests when files change |
| `npm run lint` | Checks the code for common mistakes (oxlint) |
| `npm run build` | Builds the production version into `dist/` |

## Features

| Feature | Status |
|---|---|
| Dashboard metrics (totals, Hot/Warm/Cold, conversion rate, workflows needing attention) | Working, on sample data |
| Lead capture form with validation (Zod: name, US phone, email, ZIP, service, timeline, message) | Working |
| Duplicate lead protection (same email or phone) | Working, in memory |
| Lead table with search, classification and status filters | Working |
| Lead detail panel | Working |
| Hot/Warm/Cold classification | **Simulated.** The values are hand-written. Gemini arrives in Stage 4 |
| Automation monitoring (success / retrying / failed / escalated) | **Simulated** runs. n8n arrives in Stage 6 |
| Activity & audit log | Sample events, plus real events for leads you create |

## Folder structure

```
src/
  components/   UI only (layout, leads, dashboard, monitoring)
  hooks/        useLeads, useMonitoring: loading / error / data state
  services/     leadService.js: the only data access layer (replaced by API calls in Stage 2)
  validation/   leadSchema.js: Zod rules, to be reused by the backend
  utils/        pure functions: stats, filters, formatters
  data/         SIMULATED sample data
  test/         test setup
```

## Known limitations
- **No persistence:** new leads live in memory and disappear when the page reloads.
- **AI classification is not real:** new leads stay "Pending" until Stage 4.
- **Monitoring data is static samples.** Nothing is actually being retried.
- **No authentication** yet.
- Dates show in the viewer's local time zone.

## Manual test checklist
1. The yellow "Demo mode" banner is visible on every page.
2. The dashboard shows 10 total leads, 4 Hot, 4 Warm, 2 Cold, and a 20% conversion rate.
3. **New Lead** → click *Save lead* with an empty form → an error appears under each field.
4. Type an invalid ZIP (`9021`) or email (`abc`) → you see a specific message.
5. Fill in valid data → a green "Lead LD-1011 saved…" message appears.
6. **Leads** → the new lead is at the top with a "Pending" badge.
7. Submit the same email again → a "lead already exists" error appears.
8. Filter Classification = Hot → 4 rows. Search "roofing" → only roofing leads.
9. Click a customer name → the detail panel opens. *Close* hides it.
10. **Automation** → failed or escalated runs show their last error. The activity log includes your new lead.
11. Narrow the browser window (or use phone view in DevTools) → the layout stacks and nothing overflows.
