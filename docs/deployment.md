# Deployment (Stage 9)

**Live site:** https://leadpilot-lac-psi.vercel.app
- Staff dashboard: `/` (needs the staff password)
- Public customer form: `/request` (no login)

## What runs where
```
 Customer / staff browser
          │  HTTPS
          ▼
 ┌──────────────────────── Vercel (one domain) ────────────────────────┐
 │  frontend/dist  (static files: React dashboard + /request page)      │
 │  /api/*  →  api/index.js  (ONE serverless function = the Express app) │
 └───────────┬───────────────────────────────┬──────────────────────────┘
             │                               │ events (lead.qualified, followup.approved)
             ▼                               ▼  via a Cloudflare tunnel
   Google Sheets (data)            n8n on the developer's computer (WF1–WF5)
   Gemini API (AI)                   └── calls back /api/automation/* (x-automation-key)
```

| Decision (approved 2026-11-13) | Why |
|---|---|
| **D1A** Frontend + backend on Vercel, one domain | One address, no CORS, cookies stay `SameSite=Strict`. The Express app runs unchanged as one function |
| **D2A** n8n stays on the developer's computer, reached through a free Cloudflare tunnel | Free. Self-healing re-sends lost hand-offs when n8n is back |
| **D3A** Public form page `/request` on the same site | Customers can send real leads; protected by the rate limit, honeypot and validation |
| **D4B** (changed by the developer) The existing Google Sheet, cleared, is the production database | Local development now uses `DATA_STORE=memory`, so tests never touch it |

## The pieces
| File | Job |
|---|---|
| `api/index.js` | Vercel's entry: loads `backend/app.js`. A configuration mistake → `503 SERVER_MISCONFIGURED` (which setting: only in the log) |
| `vercel.json` | Install + build commands, `/api/*` → the function, every other path → `index.html`, the page's security headers, `maxDuration: 60` s |
| `package.json` (root) | `"type": "module"` and Node 22 for the function |
| `.vercelignore` | Never upload `.env`, `STAFF-PASSWORD.txt`, `backups/`, key files |
| `backend/utils/background.js` | `keepAlive()` → `waitUntil` from `@vercel/functions`: keeps the function alive until background AI / n8n work is done (on Vercel a function may be frozen once the answer is sent) |
| `automation/scripts/point-workflows.mjs` | Makes copies of the n8n workflows that call the live site instead of `localhost:3001` |

## Settings (Vercel → leadpilot → Settings → Environment Variables)
Values are **never** written in docs, code or chat. Secrets are marked *Sensitive* (nobody can read them back).

| Variable | Production | Preview (test deploys) |
|---|---|---|
| `DATA_STORE` | `sheets` | `memory` (sample data, never the real sheet) |
| `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` | set | — |
| `GOOGLE_PRIVATE_KEY` 🔒 | set (all lines of the key!) | — |
| `GEMINI_API_KEY` 🔒 | set | — (AI off) |
| `AUTOMATION_SECRET` 🔒 | set (same as in n8n's credential) | — (automation off) |
| `N8N_WEBHOOK_BASE_URL` | `https://<tunnel>.trycloudflare.com/webhook` | — |
| `STAFF_PASSWORD_HASH` 🔒, `SESSION_SECRET` 🔒 | set | set |
| `TRUST_PROXY` | `1` | `1` |
| `NODE_ENV` | not needed (`api/index.js` defaults to `production`) | same |

A changed variable only applies to a NEW deployment: run `vercel redeploy leadpilot-lac-psi.vercel.app`.

## Deploying
From the project folder (Vercel CLI, logged in as the project owner):
```bash
vercel deploy          # a PREVIEW (test) deployment: memory store, behind Vercel's login
vercel deploy --prod   # the live site
```
⚠️ The very first `vercel deploy` of a new project goes straight to production (Vercel's rule).

GitHub auto-deploy (every push to `main` → production) is **not connected yet**: Vercel dashboard →
leadpilot → Settings → Git → connect `Syedazobiaamir/leadpilot`.

## Starting n8n for the live site
n8n and the tunnel only work while the developer's computer is on and both are running.
The free tunnel gets a **new address every time it starts**, so:
1. `n8n start` (wait until http://localhost:5678 opens)
2. `C:\Users\GibTek\tools\cloudflared\cloudflared.exe tunnel --no-autoupdate --url http://localhost:5678`
   → note the `https://….trycloudflare.com` address it prints
3. Tell Vercel the new address, then redeploy:
   ```bash
   printf "%s" "https://<new-address>.trycloudflare.com/webhook" | vercel env add N8N_WEBHOOK_BASE_URL production --force
   vercel redeploy leadpilot-lac-psi.vercel.app
   ```
4. Check: `https://leadpilot-lac-psi.vercel.app/api/health` says `"automation":"n8n"`; within 5 minutes n8n's
   executions list shows WF3 + WF5 as *Succeeded*.

While n8n is off, leads are still saved and qualified; failed hand-offs become recovery records that WF5 sends
again once n8n is back (with the NEW address in Vercel).

**Workflows → live site:** the JSON files in `automation/workflows/` call `http://localhost:3001` (local
development). For the live site, import converted copies (with n8n stopped):
```bash
node automation/scripts/point-workflows.mjs https://leadpilot-lac-psi.vercel.app <temp folder>
n8n import:workflow --input=<temp folder>/<file>.json      # for each of the 5 files
n8n publish:workflow --id=<lpWf…id>                        # for each of the 5 IDs
```
Only the 5 `lp…` workflows; never touch other workflows in the same n8n.

## Verified (2026-11-13/14)
| Check | Result |
|---|---|
| Production, read-only: health (`sheets`, `gemini-2.5-flash`), ready, staff routes 401, n8n routes 401, 404 format, page + API headers, login cookie `HttpOnly Secure SameSite=Strict Path=/api`, leads 0, report, logout | all passed |
| Preview: smoke test (`npm run smoke -- <preview URL>`) | **36/36** |
| Preview: security drills (adds Secure cookie, HSTS, page CSP) | **15/16** — the 1 = n8n route answers `503 AUTOMATION_NOT_CONFIGURED` instead of 401 because the preview has no automation key (closed either way; production gives 401) |
| n8n → live: WF5 sweep + WF3 health monitor (executions #111, #112) | succeeded |
| Tunnel: webhook without the key | 403 |
| Not yet verified on production | a real Hot lead end-to-end (AI in the background via `waitUntil`, the n8n HOT LEAD alert), an approved follow-up |

## Problems met (and fixed)
- **503 SERVER_MISCONFIGURED on the first deploy:** the setup script copied only the first line of the multi-line
  `GOOGLE_PRIVATE_KEY`. Found by running the built function locally (`vercel build`) with the same settings.
- **`vercel build` runs `npm ci`, which deletes `node_modules`:** stop the local dev servers first, and run
  `npm ci` in `backend/` and `frontend/` afterwards.
- `vercel logs` only streams NEW logs, and a startup error is logged once per new instance: reproduce locally instead.
- Preview deployments are behind Vercel's login. For automated tests either switch *Deployment Protection* off for
  the test run (and back on), or use a protection-bypass secret.

## Limitations
- **Vercel Hobby (free) is for non-commercial use.** A real business using it needs Vercel Pro.
- **In-process limits:** rate limits, the "one create at a time" queue and the `/ready` cache live in ONE function
  instance's memory. Vercel can run several instances, which then count separately (a shared store such as Redis,
  or a database lock, would fix that).
- **n8n depends on the developer's computer** and a tunnel address that changes on every start.
- The n8n editor is reachable through the tunnel (protected by the n8n login).
- Google Sheets is not a real database (no transactions, ~60 reads/minute).
- The Google and Gemini keys were not rotated (the developer's decision, see `docs/security.md`).
