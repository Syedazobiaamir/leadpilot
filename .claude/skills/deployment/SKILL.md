---
name: deployment
description: Rules for deploying LeadPilot on Vercel and connecting the local n8n through a Cloudflare tunnel (Stage 9): the function entry, vercel.json, environment variables, background work with waitUntil, preview vs production, the tunnel address, live checks and their safety limits. Use when deploying, changing vercel.json / api/index.js / environment variables, adding background work, or reconnecting n8n to the live site.
---

# Deployment

Full guide and verification results: `docs/deployment.md`. Live: https://leadpilot-lac-psi.vercel.app

## 1. Shape
- One Vercel project `leadpilot` (account `syedazobiaamir`, which also has OTHER projects: never touch them).
- `frontend/dist` is static; `/api/*` → `api/index.js` = the unchanged Express app. Never add a second function or
  framework without approval.
- `api/index.js` loads the app inside try/catch: a bad setting → `503 SERVER_MISCONFIGURED`, the reason only in the log.

## 2. Background work MUST use keepAlive
- On Vercel a function may freeze once the answer is sent. Any work started without awaiting it (AI, follow-up
  drafts, n8n events, a pipeline) must go through `keepAlive(promise)` (`backend/utils/background.js`).
- `tests/deployment.test.js` checks this for a new lead; add a test for any new background launcher and do a
  mutation check (remove keepAlive → the test must fail).
- No timers/`setInterval` jobs in the backend: scheduled work comes from n8n (WF3, WF5).

## 3. Settings and secrets
- Settings live in Vercel → Environment Variables (table in `docs/deployment.md`). Secrets are added as *Sensitive*,
  from `backend/.env`, never printed, never in chat, docs or code.
- Multi-line values (`GOOGLE_PRIVATE_KEY`) must be copied with ALL lines (a first-line-only copy caused a 503).
- Production uses `DATA_STORE=sheets`; Preview uses `memory` and no Google/Gemini/n8n keys.
- A changed variable needs a new deployment (`vercel redeploy leadpilot-lac-psi.vercel.app`).
- Sending secrets to Vercel needs the developer's explicit go-ahead in the conversation.

## 4. Safe testing
- NEVER run the smoke test, drills or test leads against production: it writes to the real Google Sheet with real
  customers. Use a preview deployment (memory store) or local servers.
- On production only read-only checks (health, ready, headers, 401s, login + reads + logout). Login allows 5 tries
  per 15 minutes per IP: don't waste tries.
- Preview deployments sit behind Vercel's login. Ask the developer to switch Deployment Protection off for the test
  run and back on afterwards (saving a bypass secret is refused by the auto-mode classifier).
- Reproduce a deployment problem locally: `vercel build --prod` + run `.vercel/output/functions/api/index.func` with
  the same settings. STOP the local dev servers first (`npm ci` deletes node_modules), reinstall afterwards, and
  delete `.vercel/output` and any pulled `.env*` files.
- The first `vercel deploy` of a NEW project goes to production.

## 5. n8n on the live site
- Repo workflows call `http://localhost:3001`. For the live site import copies made by
  `node automation/scripts/point-workflows.mjs <site> <temp dir>` (n8n stopped; only the 5 `lp…` IDs; import, then publish).
- The quick tunnel address changes on every start → update `N8N_WEBHOOK_BASE_URL` (production) + redeploy.
- Check: health `"automation":"n8n"`, webhook without key → 403 through the tunnel, WF3/WF5 executions succeed
  (n8n's database can be read read-only; `n8n execute` can't run while n8n runs).

## 6. Honest reporting
- Say which checks ran where (local / preview / production) and what is not verified yet.
- Keep `docs/deployment.md` → *Verified* and *Limitations* up to date (Hobby = non-commercial, in-process limits,
  n8n on one computer, keys not rotated by the developer's decision).
