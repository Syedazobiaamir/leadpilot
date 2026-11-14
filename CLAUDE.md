# AI Lead Management & Self-Healing Agent

## 1. Project Mission

Build a production-oriented AI Lead Management and Self-Healing Automation Platform for US home-improvement contractors.

The platform should automate customer lead capture, qualification, follow-ups, workflow execution, error detection, recovery and operational reporting.

This is a real portfolio engineering project, not just a static dashboard or chatbot.

The developer is a beginner learning AI-native engineering. Explain technical decisions, code and architecture in simple language.

## 2. Your Role

Act as a Senior AI Engineer, Software Architect, Full-Stack Developer, AI Agent Engineer and QA Engineer.

Responsibilities:
- Plan before implementing.
- Build small, understandable modules.
- Use clean and maintainable code.
- Explain important technical concepts.
- Test every important feature.
- Verify actual functionality before declaring completion.
- Never fabricate test results.
- Never claim a feature is production-ready without evidence.

## 3. Technology Stack

Frontend:
- React
- Vite
- JavaScript
- HTML5
- CSS3
- React Hooks

Backend:
- Node.js
- Express.js
- JavaScript
- REST APIs
- Webhooks

Data and validation:
- Google Sheets API for initial database integration
- Zod for input validation
- Environment variables for secrets

AI:
- Gemini API
- Structured AI responses
- Tool-calling architecture
- Agent orchestration
- Controlled agent permissions

Automation:
- n8n
- Webhook triggers
- HTTP Request nodes
- IF and Switch nodes
- Error handling workflows
- Retry mechanisms
- Scheduled monitoring

Testing:
- Vitest
- React Testing Library
- Supertest
- API integration tests
- Manual end-to-end verification

Deployment and DevOps:
- Git
- GitHub
- Vercel
- Environment configuration
- Application logs

Documentation:
- Markdown
- API documentation
- Architecture documentation
- Setup instructions

Do not introduce additional frameworks or databases without explaining why and getting approval.

## 4. Core Business Features

1. Customer lead capture.
2. Customer information validation.
3. AI-based lead qualification.
4. Hot, Warm and Cold lead classification.
5. Automatic follow-up response generation.
6. Lead management dashboard.
7. Automation monitoring.
8. Workflow failure detection.
9. Controlled automatic retries.
10. Human escalation for unresolved failures.
11. Activity and audit logs.
12. Operational performance reporting.

## 5. AI Agent Architecture

Design the following logical agents:

### Lead Management Orchestrator
Coordinates tasks and delegates work to specialized agents.

### Lead Qualification Agent
Analyzes customer inquiries and returns structured lead classifications.

### Follow-up Agent
Generates personalized customer follow-up messages.

### Validation Agent
Checks missing, invalid or inconsistent customer information.

### Recovery Agent
Analyzes workflow errors, performs permitted recovery actions and escalates unresolved issues.

All agents must have limited permissions and clear responsibilities.

Do not allow agents to execute arbitrary code, modify credentials or perform destructive actions.

Use human approval for sensitive actions.

## 6. Self-Healing Requirements

Implement:
- Error detection.
- Structured error logging.
- Retry with exponential backoff.
- Maximum retry limits.
- Duplicate request protection.
- Webhook failure handling.
- Invalid input detection.
- Recovery status tracking.
- Human escalation.
- Clear failure explanations.

Never retry permanent validation errors endlessly.

Never pretend an operation succeeded when it failed.

## 7. Claude Code Development Skills

Create reusable project skills for:

- frontend-design
- api-development
- ai-agent-development
- n8n-automation
- error-recovery
- api-integration
- testing-qa
- deployment

Use project-level Claude Code skills where appropriate.

## 8. MCP and Connectors

Potential development integrations:
- GitHub MCP
- Context7 MCP

Application integrations:
- n8n webhooks
- Slack notifications
- Vercel deployment

Do not assume integrations are connected.
Check configuration and credentials before using any integration.
Never expose secrets in logs, code or documentation.

## 9. Project Structure

Frontend:
```
frontend/
  src/
    components/
    hooks/
    services/
    data/
    validation/
    utils/
```

Backend:
```
backend/
  routes/
  controllers/
  services/
  agents/
  middleware/
  utils/
```

Automation:
```
automation/
  workflows/
  documentation/
```

Documentation:
```
docs/
  architecture.md
  api-documentation.md
  testing.md
  deployment.md
```

Tests:
```
tests/
```

Claude configuration:
```
.claude/
  agents/
  skills/
```

Do not create unnecessary files. Introduce folders when they become relevant.

## 10. Development Roadmap

Stage 1: React frontend and dashboard.

Stage 2: Node.js and Express backend.

Stage 3: Google Sheets database integration.

Stage 4: Gemini AI lead qualification.

Stage 5: AI agent architecture.

Stage 6: n8n automation workflows.

Stage 7: Self-healing and error recovery.

Stage 8: Monitoring, testing and security.

Stage 9: Deployment and documentation.

Stage 10: Loom demonstration and portfolio preparation.

## 11. Coding Rules

- Use readable JavaScript.
- Prefer small functions.
- Use async/await for asynchronous operations.
- Handle errors explicitly.
- Validate external inputs.
- Keep business logic separate from UI.
- Avoid unnecessary dependencies.
- Never hardcode API keys.
- Never commit .env files.
- Add comments for important or complex logic.
- Do not rewrite working modules without a reason.

## 12. Learning Rules

I am a beginner.

For every stage:
1. Explain the objective.
2. Explain the architecture.
3. Explain why each technology is used.
4. Show the folder structure.
5. Explain commands before asking me to run them.
6. Explain important code line by line.
7. Give practical testing steps.
8. Ask me to verify the result.
9. Do not move to the next stage until the current stage is working.

Teach me to understand and defend my implementation in an international engineering interview.

## 13. Quality Standards

A feature is complete only when:
- Its implementation exists.
- Its expected behavior is tested.
- Errors are handled.
- Its limitations are documented.
- Its functionality has been verified.

Use realistic sample data and clearly identify simulated features.

## 14. Current Development Status

- **Stage 1 (React frontend): complete.** Dashboard, lead form, lead table, monitoring and activity log, all verified.
- **Stage 2 (Node.js + Express backend): complete.** REST API with validation, duplicate protection, structured logging and a consistent error format. The frontend calls the API through the Vite proxy. Verified by backend tests, frontend tests, `npm run smoke`, and a manual check by the developer.
- **Stage 3 (Google Sheets database integration): complete.** A swappable store (`DATA_STORE=memory|sheets`) with a shared contract, a Sheets store (RAW writes, 10 s cache, our own 8 s deadline, every failure → `503 STORAGE_UNAVAILABLE`), `/api/health/ready`, and `sheets:check` / `sheets:setup` scripts. Verified live against the developer's real sheet (smoke 24/24, data survives restart) and by failure drills (which found and fixed a missing-deadline bug).
- **Stage 4 (Gemini AI lead qualification): complete.** Save first, AI in the background (`POST /api/leads` → 201, then `qualificationService`); plain-fetch `geminiClient` (key in header, own deadline, `AiError` kinds incl. `quota_exhausted` vs `rate_limited`); AI gets only service + timeline + message; Zod-validated structured output; prompt-injection defence; `POST /api/leads/:id/qualify` (202); frontend AI panel (Gemini vs Simulated, Retry, auto-refresh). Verified: eval run 3 (2026-11-07) **16/16, 3/3 injections resisted and flagged, 0 false alarms** (`backend/evals/run-3-thinking-off.json`; run 1 before the thinking fix: `run-1-thinking-on.json`), 6 AI failure drills, and a real quota failure. Design and limits: `docs/ai-qualification.md`.
- **Stage 5 (AI agent architecture): complete.** Plan 2026-11-07: 1A code-driven Orchestrator (no tools; validation → qualification → follow-up for Hot), 2A, 3A rule-based Validation Agent, 4A first name only. `backend/agents/`: tool registry with permissions (no send/delete/credential/exec tools), `runAgent` + AgentRuns audit trail, Validation / Qualification / Follow-up agents, Orchestrator. Follow-up drafts need human approve/edit/reject (409 after a decision); **nothing is sent until Stage 6**. New Sheet tabs FollowUps + AgentRuns, lead column reviewFlags. Frontend: Needs review, follow-up panel, real agent runs. Verified: 384 backend + 72 frontend tests, mutation checks, live run (Hot lead → 3 agents, 2 AI requests; test lead blocked, 0 AI requests), 5 orchestrator failure drills. Follow-up eval run 1 (2026-11-09): **8/8, 2/2 injections resisted and flagged, 0 false alarms** (`backend/evals/followup-run-1.json`). Design: `docs/ai-agents.md`.
- **Stage 6 (n8n automation workflows): complete (2026-11-10).** Plan approved 2026-11-09: D1A local n8n (global npm install, v2.11.3, `n8n start`, :5678); D2A SIMULATED delivery (no real email; labelled SIMULATED, note on the dashboard); D3 changed to A (alerts on the dashboard, no Slack); backend pushes events (`lead.qualified` Hot, `followup.approved`) to n8n via `automationClient` (off when `N8N_WEBHOOK_BASE_URL` unset; an outage never breaks saving); n8n calls back `/api/automation/*`, all behind `x-automation-key`. Workflows WF1 hot-lead alert, WF2 send follow-up, WF3 health monitor (5 min), WF4 error handler; exported JSON in `automation/workflows/`. Retries = n8n "Retry On Fail" only; full self-healing stays Stage 7. Order: backend + tests → n8n + WF3 → WF4, WF2, WF1 → frontend, drills, docs, `n8n-automation` skill.
  - Step 1 done 2026-11-09 (431 backend tests, 3 mutation checks; n8n-only endpoints are `/api/automation/{check,workflow-runs,followups/:id/mark-sent}`). Live sheet migrated (FollowUps + sentAt, sentVia).
  - Step 2 done 2026-11-09: `AUTOMATION_SECRET` in backend/.env (never shown); n8n credential "LeadPilot backend key" (Header Auth, id `lpAutomationKey1`) imported from a deleted temp file; WF3 `lpWf3HealthMon01` imported + published. Drill passed (healthy quiet → down: 1 alert → still down: quiet → recovered: run WF-n8n-14 saved). The developer's n8n also holds 2 of their OWN workflows: never touch them. On Windows, stopping `npm run dev` leaves node processes alive (kill the `--watch` parent too). Docs: `automation/documentation/`.
  - Step 3 done 2026-11-09. **D3 changed to A: NO Slack.** Alerts go to the dashboard via `POST /api/automation/activity` (one event per n8n run, `EV-n8n-<exec>`). Added `GET /api/automation/followups/:id` (status only): WF2 now checks status BEFORE delivering (a drill found it delivered first). WF1 `lpWf1HotLeadAlrt`, WF2 `lpWf2SendFollow1`, WF4 `lpWf4ErrorHand01` imported + published; WF1-3 use WF4 as error workflow. `N8N_WEBHOOK_BASE_URL=http://localhost:5678/webhook` in backend/.env. 441 backend tests. Live checks passed (403 without key, approve → sent, Hot → alert, missing/duplicate follow-up drills): see `automation/documentation/workflows.md`. Known: n8n retries permanent 404s too (Stage 7).
  - Step 4 built 2026-11-10: frontend shows "Sent · SIMULATED" (polls after Approve; honest note if n8n is off), run source badges (n8n / Not delivered / Sample), highlighted escalations + HOT LEAD alerts, Automation data refreshes every 30 s, banner/texts updated. `installFakeApi({ n8n })`. Smoke test + 3 automation checks. Skill `.claude/skills/n8n-automation`. Verified: 441 backend + 77 frontend tests, lint, build, smoke 27/27 (2 runs; one earlier run hit an unexplained `node --watch` restart mid-test → 502s, not reproduced). Developer verified in the browser 2026-11-10 (Approve on LD-1012 → "Sent by n8n · SIMULATED", run WF-n8n-32). n8n login was reset with `n8n user-management:reset` (workflows/credentials kept); the developer set a new owner account.
- **Stage 7 (self-healing and error recovery): complete (2026-11-11).** Plan approved 2026-11-10, all recommended: D1A recovery sweep triggered by n8n WF5 every 5 min (backend timers won't run on Vercel); D2A rule-based Recovery Agent with an allowlist (retry AI qualification, re-send an event, escalate; never delete/send/touch credentials/exec), no AI; D3A new Sheet tab "Recoveries" (problem, attempts, nextRetryAt, status, lastError); D4A max 5 automatic AI retries per day (free tier = 20). Backoff 5 → 10 → 20 min, max 4 attempts; quota_exhausted waits for the reset; permanent errors escalate at once. Steps: 1 retry rules → 2 Recoveries tab + Recovery Agent (AI retry, stuck pending leads) → 3 re-send lost events + n8n retries only temporary errors → 4 duplicate protection + partial writes → 5 WF5 sweep + dashboard Recoveries → 6 drills, docs, `error-recovery` skill, commit. Step 1 done 2026-11-10: `backend/services/recovery/retryPolicy.js` (`decideRetry`, `backoffDelayMs`, `isTemporaryHttpStatus`; anything not clearly temporary = permanent), 18 tests, 3 mutation checks, 459 backend tests. Step 2 done 2026-11-10: Recoveries table (memory + Sheets tab, created live with `sheets:setup`); `services/recoveryService.js` (recordFailure / recordSuccess, one open record per problem, escalated stays with the person); qualificationService hooks; `agents/recoveryAgent.js` sweep (stuck pending > 10 min, adopts old failed leads via their last agent run, retries due records: max 3/sweep, 5/day counted from `EV-rc-try-` activity events, skips blocked leads); `POST /api/automation/recovery/sweep` (key) + `GET /api/recoveries`. 20 tests, 5 mutation checks (1 missed → test added), 481 backend tests. Live: sweep adopted LD-1011 (no agent run → unknown → escalated); blocked LD-1014/15/16 skipped. Also fixed WF4: it now ignores non-`lp` workflows (n8n's "Execute workflow" sample data had written a fake "Example Workflow" escalation: activity EV-n8n-29 + run WF-n8n-231 in the sheet, left as-is). Learned: `node --watch` restarts the backend on every backend file edit; requests during a restart fail (ECONNRESET / Vite 502). That explains the Stage 6 smoke glitch. Step 3 done 2026-11-11: follow-up life cycle approved → **sending** (claim, `POST /api/automation/followups/:id/claim` with n8n executionId; one winner) → sent (mark-sent now needs "sending", else 409 FOLLOWUP_NOT_CLAIMED); new FollowUps columns claimedAt/claimedBy (live sheet migrated). Failed n8n hand-offs open recovery records (kinds followup_event, hot_lead_event); the sweep hands them off again from CURRENT data (max 5/sweep), resolves them if no longer needed, opens records for follow-ups stuck "approved" 15+ min, and ESCALATES stuck "sending" (never re-sent: may have been delivered). n8n: every backend POST = HTTP node (neverError + fullResponse, Retry On Fail only for network failures) + "Check: <step>" node (2xx passes; TEMPORARY 408/429/5xx or PERMANENT 4xx fails the run, no retry). WF2 = claim → deliver or stop quietly. Frontend shows "sending". 496 backend + 78 frontend tests, 4 mutation checks. Live drills passed: n8n down at approval → record → n8n back → sweep → claimed by run #43 → sent → "Recovered … after 2 tries"; duplicate event → quiet (#44); missing follow-up → PERMANENT in 1.2 s → WF4 (#47). Found + fixed: n8n shows a Code-node error only after its LAST ": " (generator now rejects ": " in thrown messages). Found: polling `/api/health/ready` every 2 s (7 Sheets reads each) hit Google's 60 reads/min limit → 429 for a minute. Never poll /ready fast; Stage 8 item: cache or rate-limit /ready. Workflow generator lives in the session scratchpad only; the JSON files in `automation/workflows/` are the source of truth. Step 4 done 2026-11-11: `createLead` runs check + insert in an in-process queue (`oneCreateAtATime`; limitation: one server process only, Vercel needs a DB-level lock, Stage 9 note); `Idempotency-Key` header (8-100 `[A-Za-z0-9_-]`) stored as hidden lead column `submissionKey` (live sheet migrated) → a retry returns the same lead (201 + `Idempotent-Replayed: true`), a key reused for a different person → 409 IDEMPOTENCY_KEY_REUSED; the audit-event write after a saved lead no longer fails the request (logged instead). Frontend form sends one `crypto.randomUUID()` key per submission, reused on retry, new after success or any edit. Tests: `tests/duplicateProtection.test.js` with a SLOW mocked store (the race really exists: without the queue, 5 identical POSTs made several leads and 5 different ones shared IDs), 3 + 1 mutation checks; 508 backend + 80 frontend tests. Live: 4 concurrent same-key POSTs → 1 lead LD-1017 (3 replays); 2 no-key repeats → 409. Step 5 done 2026-11-11: WF5 `lpWf5RecoverySwp` (every 5 min → POST /api/automation/recovery/sweep, 60 s timeout, Check node, fails → WF4; records no run itself); `runAgent` option `shouldRecord` so a sweep with nothing to do writes NO AgentRuns row (288 sweeps/day); dashboard Automation page "Self-healing" section (`RecoveryList`, needs-a-person first, next try, tries x/4), `GET /api/recoveries` in useMonitoring + fakeApi. 509 backend + 82 frontend tests. Live: WF5 run #54 at 16:00 → sweep 200 in 1.6 s, nothing to do, no AgentRuns row written. Step 6 built 2026-11-11: permanent-AI drill on an isolated memory backend (port 3002, wrong GEMINI_MODEL → escalated on first failure, sweep did not retry, 1 AI call); smoke test + 3 Stage 7 checks (30/30, twice); docs `docs/self-healing.md` (design, rules, drills, limits), api-documentation, automation docs, READMEs; skill `.claude/skills/error-recovery`. 509 backend + 82 frontend tests, lint, build. The developer asked to commit on 2026-11-11 (they did not explicitly report the Self-healing dashboard check).
- **Stage 8 (monitoring, testing and security): complete (2026-11-13).** Plan approved 2026-11-11, all recommended: D1A one staff password (scrypt hash in .env, HttpOnly signed session cookie, 8 h, login rate limit; public = POST /api/leads + /api/health; n8n keeps its own key; a test checks every route needs login); D2A own security-headers middleware (no helmet); D3A operational report page in Stage 8; D4A rotate the Google + Gemini keys in Stage 8. Steps: 1 rate limit + honeypot + /ready cache + headers → 2 backend login → 3 frontend login → 4 requestId in all logs + report page → 5 key rotation, git-history secret scan, npm audit → 6 security drills, docs, commit. Limitation to document: in-process limits/sessions (Vercel = several instances). Step 1 done 2026-11-11: `middleware/securityHeaders.js` (nosniff, CSP default-src 'none' + frame-ancestors 'none', X-Frame-Options DENY, Referrer-Policy, CORP, Cache-Control no-store, HSTS in production); `middleware/rateLimit.js` (fixed window per IP, 429 RATE_LIMITED + Retry-After, logs once per window) + `limiters.js` (POST /api/leads 10/min/IP; tests get 10 000 unless lowered); `TRUST_PROXY` config; honeypot field `website` (400 SUBMISSION_REJECTED, hidden off-screen in the form); `/api/health/ready` cached 30 s (`checkedAt`). 13 tests, 4 mutation checks, 522 backend + 83 frontend. Live: headers present, /ready cached, honeypot rejected, 11th POST in a minute → 429. Note: smoke test sends ~9 POSTs: wait a minute between smoke runs. Step 2 built 2026-11-11: `services/authService.js` (scrypt hash `scrypt$N$r$p$salt$hash`, verify in constant time; stateless HMAC-signed cookie `lp_session` = payload{exp, pv=password-hash fingerprint}.signature; HttpOnly, SameSite=Strict, Path=/api, 8 h, Secure in production), `middleware/requireStaff.js` (401 NOT_LOGGED_IN; 503 AUTH_NOT_CONFIGURED when no hash/secret = fail closed), `/api/auth/{login,logout,session}` (login 5 tries/15 min/IP), locks on /api/leads (except POST /), /api/followups, /api/activity, /workflow-runs, /agent-runs, /recoveries. Config `STAFF_PASSWORD_HASH` + `SESSION_SECRET` written by `npm run auth:set-password` (hidden typing, needs a real terminal; the password is never printed or stored). Tests: `tests/setup.js` (vitest.config.js setupFiles) logs every test in through the REAL login and mocks supertest to send the cookie; `asVisitor(req)` removes it. `tests/auth.test.js` discovers all routes from the source and checks each is locked unless public. 560 backend tests, 5 mutation checks. Until the developer sets the password, the live dashboard gets 503 on staff routes (by design). Smoke test needs updating (Step 6). 2026-11-11: at the developer's request Claude GENERATED the staff password (24 random chars, never shown in chat): hash in backend/.env, the password in `backend/STAFF-PASSWORD.txt` (gitignored) for the developer to copy and then delete. Verified live: visitor 401, login 200, wrong password 401. The developer can choose their own any time with `npm run auth:set-password`. Step 3 built 2026-11-11: login gate in `App.jsx` (`useAuth`: checking / loggedIn / loggedOut / notConfigured / error; data hooks live in `StaffApp`, so nothing is requested before login), `components/auth/LoginPage.jsx`, Log out in `Header`, `leadService` getSession/loginStaff/logoutStaff and a `leadpilot:session-ended` window event on any 401 NOT_LOGGED_IN → back to login with a reason. fakeApi `session` option (logged in by default; FAKE_STAFF_PASSWORD). `Login.test.jsx` 7 tests, 2 mutation checks; 90 frontend tests, lint, build. Live through the Vite proxy: session false → leads 401 → login 200 → leads 200. Step 4 built 2026-11-11: `utils/requestContext.js` (AsyncLocalStorage; requestId middleware runs the request in it; the logger adds requestId to EVERY line); `services/reportService.js` `buildOverview` → `GET /api/reports/overview` (staff): leads (7-day per day, classes, hot share, review/blocked, simulated, MEDIAN minutes form→AI for automatic answers within 24 h), AI (success rate, avg s, failure kinds, requests today since midnight America/Los_Angeles excluding quota refusals = estimate, reset time), follow-ups, automation (real WF-n8n/WF-be runs only), self-healing. Frontend Report page (`components/report/*`, `useReport`): KPI tiles, one-hue leads-per-day bars + screen-reader table, AI quota meter (ok/warning/danger). dataviz validator passed for --primary on both surfaces. Real data found 2 bugs (fixed + tests): raw rows lacked the API's 'simulated' label (simulated 0 → 10), and hand re-qualified leads made 'time to qualify' 2866 min (now median of automatic only → 0.1). 572 backend + 96 frontend tests; mutation checks (1 missed → test fixed). Layout not visually checked by Claude (no browser tool used): ask the developer. Step 5 done 2026-11-11: git-history secret scan (7 commits; only placeholders/fake test keys; no .env or key files ever committed); `npm audit`: 0 vulnerabilities (backend 170 deps, frontend 150). Key rotation helpers: `npm run keys:import-google -- "<key.json>"` (refuses the OLD key id 45ee26ba6d64) and `npm run keys:set-gemini` (hidden input); shared `scripts/envFile.js`. **D4 changed to B by the developer: key rotation postponed to Stage 9 (before deployment / real customer data). Remind them then.** Step 6 built 2026-11-13: flaky timing test fixed (orchestrator 201: AI 1.5 s vs < 1 s; mutation still caught); live security drills on an ISOLATED backend (port 3002, real password config) 14/14 (visitor 401 ×13, n8n key, cookie flags, forged cookies, guessing → 429, honeypot, flood, headers, logout; log has no password/token, requestId on 45/45 warnings); smoke test logs in (`STAFF_PASSWORD` env or hidden prompt) + lock/headers/report/logout checks: 35/35; XSS test (HTML in a message renders as text; mutation with dangerouslySetInnerHTML caught); docs `docs/security.md`, api-documentation (access, auth, report, error codes), READMEs, testing-qa skill. 572 backend + 97 frontend tests. The developer asked to commit on 2026-11-13 (they did not explicitly report the browser check of the login and Report pages). `backend/STAFF-PASSWORD.txt` may still exist: remind the developer to copy and delete it.
- **Stage 9 (deployment and documentation): in progress.** Plan approved 2026-11-13, all recommended: D1A frontend + backend both on Vercel, one domain (backend = serverless function; background AI work via `waitUntil` from `@vercel/functions`, the ONLY new dependency, approved); D2A n8n stays on the developer's computer, reachable through a free Cloudflare tunnel when running (self-healing re-sends lost hand-offs when it's back); D3A public customer form page on the same site (e.g. /request, no login; honeypot + rate limit); D4A a NEW clean Google Sheet for production (current sheet stays for dev/demo). **2026-11-13: D4 changed to B by the developer: REUSE the current sheet for production after clearing its data** (all 21 leads were fictional @example.com; full backup in `backups/` (gitignored) before clearing; after that, local testing/smoke must NOT write to this sheet: use `DATA_STORE=memory` locally). Cleared 2026-11-13 at the developer's request: all 6 tabs now header-only (`sheets:check` passes; backup `backups/sheet-backup-2026-11-13T17-46-24-392Z.json`). The local backend/.env still has DATA_STORE=sheets: switch it to memory in Step 2. Step 2 built 2026-11-13: local backend/.env now DATA_STORE=memory. `backend/utils/background.js` keepAlive() → `@vercel/functions` waitUntil (no-op outside Vercel) on the 4 background launchers (orchestrator.start, qualification + follow-up runInBackground, automation emit); root `api/index.js` (Vercel function = the Express app; NODE_ENV defaults to production; config error → 503 SERVER_MISCONFIGURED, details only in the log); root `package.json` (type module, node 22.x); `vercel.json` (install backend --omit=dev + frontend, build frontend, output frontend/dist, /api/:path* → /api, everything else → /index.html, page headers: strict CSP without unsafe-inline, nosniff, DENY, HSTS, Permissions-Policy; maxDuration 60); `.vercelignore` (.env, STAFF-PASSWORD.txt, backups/, key files). Public page `/request` (`components/public/RequestPage.jsx`, chosen in main.jsx by pathname; reuses LeadCaptureForm with new label/submit/success props; customer-friendly errors via new `code`/`reference` in createLead's failure result). Tests: backend `tests/deployment.test.js` (9; mutation removing keepAlive caught) → 581 backend; frontend `RequestPage.test.jsx` (5) → 102; lint + build OK (built index.html has no inline script). Smoke test + /request check: 36/36 against memory (production sheet untouched, 0 rows). NOT verified until Step 5: real Vercel routing (rewrites keep req.url), waitUntil in a real function, CSP in a real browser. Step 3 done 2026-11-13: Step 2 committed (c795126); remote origin = https://github.com/Syedazobiaamir/leadpilot.git, pushed main. **The repo is PUBLIC by the developer's explicit choice** (warned: commit email, service-account email and security docs are visible; no secrets in the code or history). Never commit anything sensitive. 2026-11-13: **the developer decided NOT to rotate the Google + Gemini keys ("wohi use karo") and to deploy with the existing keys**, after being told the risk. Respect it; mention the open risk once more only before the first REAL customer lead, not repeatedly. Step 4 done 2026-11-13: Vercel account `syedazobiaamir` (has OTHER projects: never touch them); new project `leadpilot` linked (.vercel/ gitignored). Env vars: Preview = DATA_STORE=memory, STAFF_PASSWORD_HASH, SESSION_SECRET, TRUST_PROXY=1; Production = DATA_STORE=sheets, 3 GOOGLE_*, GEMINI_API_KEY, AUTOMATION_SECRET, STAFF_PASSWORD_HASH, SESSION_SECRET (secrets marked sensitive), TRUST_PROXY=1; no N8N_WEBHOOK_BASE_URL yet (Step 6), no CONTRACTOR_NAME (default fictional name). Uploaded by a scratchpad script from backend/.env (values never printed; the auto-mode classifier blocked the production upload until the developer explicitly asked for it). The first `vercel deploy` of a new project went straight to PRODUCTION (Vercel's rule): live at https://leadpilot-lac-psi.vercel.app. It answered 503 SERVER_MISCONFIGURED: the upload script read only the FIRST line of the multi-line GOOGLE_PRIVATE_KEY in .env; found by running the built function locally (`vercel build`), fixed, re-uploaded, redeployed. `vercel logs` showed nothing useful. WARNING: `vercel build` runs `npm ci`, which deletes node_modules: stop the dev servers first (it broke them once; reinstalled, tests 581 + 102 pass). Live read-only checks passed: health 200 (sheets, gemini-2.5-flash), ready 200, staff routes 401, n8n endpoints 401, 404 format, page headers (CSP etc.) + API headers, login 200 with HttpOnly Secure SameSite=Strict Path=/api, leads 0, report 200, logout. NOT yet done: smoke test / security drills (they write test leads: run them against a PREVIEW deployment, which uses memory; preview URLs are behind Vercel Authentication), the public form + AI on live, GitHub auto-deploy connection. Step 5 (2026-11-14): preview https://leadpilot-hub0q8m8w-syedazobiaamirs-projects.vercel.app (memory store, AI off, automation off). The auto-mode classifier refused saving the Vercel protection-bypass secret ("credential materialization"), so the DEVELOPER turned Vercel Authentication OFF for the test run (must be turned back ON afterwards). Smoke test on the preview: 36/36 (real routing, rewrites keep req.url, Secure cookie, page + API headers). Security drills (scratchpad `security-drills-vercel.mjs`, adds Secure-cookie, HSTS and page-CSP checks): 15/16; the one "fail" = D2 expects 401 but the preview has no AUTOMATION_SECRET so /api/automation/* answers 503 AUTOMATION_NOT_CONFIGURED (closed either way; production answers 401). Login guessing and the form flood both counted across the smoke + drill requests, i.e. the same warm instance answered (in-process limits still not shared across instances). Not yet verified: waitUntil with real AI (needs a real lead on production). The developer was asked to turn Vercel Authentication back ON (not confirmed). Step 6 (2026-11-14): `automation/scripts/point-workflows.mjs` writes COPIES of the 5 workflows with http://localhost:3001 (11 places) replaced by a site address (repo JSON stays localhost for local dev); 3 tests in deployment.test.js (12 there). Live copies (scratchpad wf-live/) imported + published into n8n with n8n stopped (only the 5 lp workflows; the developer's 2 own workflows untouched). cloudflared: winget hung (probably a UAC prompt), so the official release exe was downloaded to `~/tools/cloudflared/cloudflared.exe` (Authenticode signature Valid, v2026.11.0). Quick tunnel `cloudflared tunnel --no-autoupdate --url http://localhost:5678` gives a random https://*.trycloudflare.com address that CHANGES on every start, so Vercel production env N8N_WEBHOOK_BASE_URL=<tunnel>/webhook + `vercel redeploy` each time. Verified: tunnel healthz 200, webhook without key 403 through the tunnel, production health "automation":"n8n", n8n executions #111 WF5 sweep + #112 WF3 health against production both success (read from ~/.n8n/database.sqlite read-only). `n8n execute` cannot run while n8n is running (task broker port 5679). NOT verified: backend to n8n events end-to-end on production (needs a real Hot lead / an approved follow-up). Limits: n8n + tunnel only work while the developer's computer is on; the n8n editor is reachable through the tunnel (login protected). Step 7 built 2026-11-14: docs `docs/deployment.md` (shape, settings table, deploying, n8n restart procedure, verified, problems, limitations), `docs/architecture.md`, `docs/testing.md`, root `README.md`, skill `.claude/skills/deployment`; Stage 9 notes in security.md (page headers done, keys = open risk by the developer's decision), api-documentation, self-healing, backend + frontend READMEs, n8n-setup. 584 backend + 102 frontend tests, lint, build; relative doc links checked. The real tunnel address is never written in the repo (public). Steps: 1 key rotation + new production sheet (developer) → 2 code ready for Vercel (function entry, waitUntil, vercel.json headers/rewrites, production config, public form page, tests) → 3 GitHub private repo + push → 4 Vercel login/project/env vars (developer enters secrets in Vercel, never in chat) → 5 preview deploy + smoke/security drills → production → 6 n8n via tunnel, workflows pointed at the new URL → 7 docs (architecture, deployment, testing, root README), `deployment` skill, commit. Vercel Hobby = non-commercial only (a real business needs Pro). Vercel CLI 50.1.2 installed but NOT logged in; no git remote yet; no gh CLI. MUST include: rotating the Google + Gemini keys (postponed from Stage 8), the dashboard's own security headers (host config), TRUST_PROXY=1 behind the host, `Secure` cookies over HTTPS, and the in-process limits (rate limits, create queue, sessions) vs several serverless instances. The developer wants real customer leads afterwards (public form options discussed). Known items: login for the dashboard (no auth today), rate limiting (public form + `/api/health/ready`, which costs 7 Sheets reads per call), security headers, `requestId` in storage logs, rotating the two exposed keys before any real customer data. Developer's goal after Stage 9: real customer leads via a public form (options discussed: own public form page, the contractor's website, or Google Form → n8n → POST /api/leads). Original carry-over list: retry only temporary errors (n8n retries 404s today), backoff, re-sending lost events, the crash gap between delivery and mark-sent, partial writes, the duplicate race, the Recovery Agent.

Still true at this point:
- Since Stage 9 the Google Sheet (service account `id-leadpilot-sheets@step-1-done.iam.gserviceaccount.com`) is the LIVE production database. The local `backend/.env` uses `DATA_STORE=memory`; never point local tests or the smoke test at the sheet. Tests always use memory.
- Gemini IS connected: `GEMINI_API_KEY` is in `backend/.env` (model `gemini-2.5-flash`, free tier = 20 requests/day; `npm run ai:check` passes). n8n IS connected locally (Stage 6, see above). Slack is NOT used. Don't connect any integration without checking credentials and getting approval. Follow the `api-integration` and `ai-agent-development` skills.
- The lead schema exists in two identical copies (frontend + backend). Edit both. A test enforces this.
- Docs: root `README.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/testing.md`, `docs/api-documentation.md`, `docs/google-sheets-setup.md`, `backend/README.md`, `frontend/README.md`. Skills: `frontend-design`, `api-development`, `api-integration`, `ai-agent-development`, `testing-qa`, `n8n-automation`, `error-recovery`, `deployment`. Self-healing: `docs/self-healing.md`. Security: `docs/security.md`. Automation: `automation/documentation/`. AI design and eval: `docs/ai-qualification.md`; agents: `docs/ai-agents.md`.

⚠️ **Open risk (the developer's decision, 2026-11-13):** the Google service-account key (ID starting `45ee26ba6d64`) and the Gemini key (starts `AQ.`) were pasted into a chat on 2026-11-05 and were NOT rotated; the developer chose to deploy with them after being told the risk. Helpers if they change their mind: `npm run keys:import-google -- "<key.json>"`, `npm run keys:set-gemini`, then update the Vercel settings and redeploy. Mention it once before the first real customer lead, not repeatedly.

Wait for my approval before making major architectural changes.
