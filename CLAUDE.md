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
- **Next: Stage 7 (self-healing and error recovery).** Not started. Propose a plan first. Carry over: retry only temporary errors (n8n retries 404s today), backoff, re-sending lost events, the crash gap between delivery and mark-sent, partial writes, the duplicate race, the Recovery Agent.

Still true at this point:
- The developer's `backend/.env` has `DATA_STORE=sheets` and is connected to their Google Sheet (service account `id-leadpilot-sheets@step-1-done.iam.gserviceaccount.com`). Tests always use memory.
- Gemini IS connected: `GEMINI_API_KEY` is in `backend/.env` (model `gemini-2.5-flash`, free tier = 20 requests/day; `npm run ai:check` passes). n8n IS connected locally (Stage 6, see above). Slack is NOT used. Don't connect any integration without checking credentials and getting approval. Follow the `api-integration` and `ai-agent-development` skills.
- Known Stage 7 items: partial writes (a lead saved but its activity write failed → client sees 503), the duplicate check-then-insert race, no retries yet.
- The lead schema exists in two identical copies (frontend + backend). Edit both. A test enforces this.
- Docs: `docs/api-documentation.md`, `docs/google-sheets-setup.md`, `backend/README.md`, `frontend/README.md`. Skills: `frontend-design`, `api-development`, `api-integration`, `ai-agent-development`, `testing-qa`, `n8n-automation`. Automation: `automation/documentation/`. AI design and eval: `docs/ai-qualification.md`; agents: `docs/ai-agents.md`.

⚠️ **Open security TODO: rotate the Google service account key.** The current key (ID starting `45ee26ba6d64`)
was pasted into a chat on 2026-11-05. The developer chose to keep it temporarily while the sheet holds only
SIMULATED sample data. Before any real customer data is stored, and before deployment (Stage 9): delete that key in
Google Cloud (IAM & Admin → Service Accounts → KEYS), create a new one, update `backend/.env`, and remove this note.

⚠️ **Open security TODO: rotate the Gemini API key.** The current `GEMINI_API_KEY` (starts with `AQ.`) was also
pasted into a chat on 2026-11-05, and the developer chose to keep it for now. Anyone with it can use the AI quota
(and spend money if billing is ever enabled). Rotate it before enabling billing, before real customer data, and
before deployment: Google AI Studio → API keys → delete it → create a new one → update `backend/.env` → remove this note.

Wait for my approval before making major architectural changes.
