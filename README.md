# LeadPilot

**AI lead management and self-healing automation for US home-improvement contractors.**

A customer asks for an estimate → the lead is validated and saved → AI rates it Hot / Warm / Cold and drafts a
follow-up for a person to approve → n8n runs the alerts and sending → when background work fails, the system
retries safely or calls a person.

- **Live:** https://leadpilot-lac-psi.vercel.app (staff dashboard, login required) ·
  https://leadpilot-lac-psi.vercel.app/request (public customer form)
- A portfolio project built step by step (Stages 1–9). Email delivery is **SIMULATED**; sample data is marked
  as simulated.

## Features
| | |
|---|---|
| Lead capture | Public form + staff form, Zod validation in the browser and on the server, duplicate and double-submit protection, honeypot, rate limit |
| AI qualification | Gemini with structured (schema-checked) output, prompt-injection defence, runs in the background |
| AI agents | Orchestrator → Validation (rules) → Qualification (AI) → Follow-up draft (AI, human approval) |
| Automation | n8n: Hot-lead alert, follow-up sending (simulated), health monitor, error handler, recovery sweep |
| Self-healing | Recovery records, backoff 5 → 10 → 20 min, retry limits, escalation to a person |
| Dashboard | Leads, AI panel, follow-ups, agent runs, workflow runs, audit log, self-healing, operational report |
| Security | Staff login (signed HttpOnly cookie), every route locked by default, security headers, no secrets in logs |

## Tech stack
React + Vite · Node.js + Express · Zod · Google Sheets API · Gemini API · n8n · Vitest, React Testing Library,
Supertest · Vercel · Cloudflare tunnel.

## Run it locally
Requires Node.js 22+.
```bash
cd backend  && npm install && npm run dev   # http://localhost:3001  (settings: backend/.env, see backend/README.md)
cd frontend && npm install && npm run dev   # http://localhost:5173  (/request = the public form)
```
With `DATA_STORE=memory` (the default) it runs on simulated sample data with no accounts at all.

## Project structure
```
api/          Vercel entry point (the Express app as one function)
backend/      Express API, agents, stores, scripts, tests
frontend/     React dashboard + public form, tests
automation/   n8n workflows (JSON), docs, scripts
docs/         architecture, API, deployment, testing, security, AI, self-healing
.claude/      project skills for Claude Code
```

## Documentation
| Topic | File |
|---|---|
| Architecture and decisions | [docs/architecture.md](docs/architecture.md) |
| API reference | [docs/api-documentation.md](docs/api-documentation.md) |
| Deployment (Vercel, n8n tunnel) | [docs/deployment.md](docs/deployment.md) |
| Testing | [docs/testing.md](docs/testing.md) |
| Security | [docs/security.md](docs/security.md) |
| AI qualification and evaluation | [docs/ai-qualification.md](docs/ai-qualification.md) |
| AI agents | [docs/ai-agents.md](docs/ai-agents.md) |
| Self-healing | [docs/self-healing.md](docs/self-healing.md) |
| Google Sheets setup | [docs/google-sheets-setup.md](docs/google-sheets-setup.md) |
| n8n setup and workflows | [automation/documentation/](automation/documentation/) |
| Backend / frontend details | [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md) |

## Status and limits
584 backend + 102 frontend tests, smoke test 36/36 on Vercel, live security drills. Known limits (free hosting
tier, n8n on one computer, Google Sheets as the database, in-memory limits on serverless, the Gemini free tier of
20 requests/day) are listed in [docs/deployment.md](docs/deployment.md#limitations).
