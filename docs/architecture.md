# Architecture

LeadPilot captures leads for a US home-improvement contractor, qualifies them with AI, drafts follow-ups for a
person to approve, runs automations in n8n, and repairs its own background failures.

## The big picture
```
                ┌──────────────── Browser ────────────────┐
                │ /request  public customer form           │
                │ /         staff dashboard (login)        │
                └───────────────┬──────────────────────────┘
                                │ fetch /api/...  (same domain; session cookie)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ Express API (backend/)          locally: server.js  ·  live: api/index.js    │
│  middleware: security headers → requestId → logger → JSON (10 KB) → routes   │
│  routes → controllers → services → leadStore ─┬─ memoryStore (dev, tests)    │
│                                               └─ sheetsStore → Google Sheets │
│  agents/: Orchestrator → Validation → Qualification (Gemini) → Follow-up     │
│           Recovery Agent (rule-based sweep)                                  │
│  automationClient ── events ──► n8n webhooks (x-automation-key)              │
└──────────────▲───────────────────────────────────────────────┬───────────────┘
               │ /api/automation/* (x-automation-key)          │
        ┌──────┴──────────────── n8n ──────────────────────────▼──────┐
        │ WF1 hot-lead alert · WF2 send follow-up (SIMULATED)         │
        │ WF3 health monitor (5 min) · WF4 error handler              │
        │ WF5 recovery sweep (5 min)                                  │
        └─────────────────────────────────────────────────────────────┘
```

## Layers (backend)
| Layer | Folder | Rule |
|---|---|---|
| Routes | `routes/` | URL + method → controller; locks (`requireStaff`, `requireAutomationKey`, rate limits) are attached here |
| Controllers | `controllers/` | Read the request, call a service, send the answer. No business rules |
| Services | `services/` | Business rules (leads, follow-ups, automation, recovery, reports) |
| Agents | `agents/` | AI and rule-based agents with a tool registry and permissions |
| Store | `services/leadStore.js` + `stores/` | One contract, two stores (memory / Google Sheets); `tests/storeContract.js` proves they behave the same |
| Integrations | `services/ai/geminiClient.js`, `stores/sheetsClient.js`, `automation/automationClient.js` | The ONLY code that calls each outside service: own deadline, errors translated to `kind` + `temporary` |

## A new lead, step by step
1. The form validates in the browser (Zod), then `POST /api/leads` with an `Idempotency-Key`.
2. The server checks the rate limit (10/min/IP), the honeypot, the same Zod schema, duplicates (email/phone), then
   saves the lead (one create at a time) and answers **201** at once.
3. In the background (kept alive on Vercel by `waitUntil`), the **Orchestrator** runs:
   - **Validation Agent** (rules): flags vague / test / suspicious input; a blocked lead gets NO AI call.
   - **Qualification Agent** (Gemini): gets only service + timeline + message; the answer must match a Zod schema
     (Hot/Warm/Cold, score, reason). Prompt injection is resisted and flagged.
   - **Follow-up Agent** (Gemini, Hot leads): writes a DRAFT email; a person must approve, edit or reject it.
4. A Hot lead → event `lead.qualified` → n8n WF1 → alert on the dashboard.
5. An approved draft → event `followup.approved` → n8n WF2 claims it, "sends" it (SIMULATED), marks it sent.

Every agent run is recorded (AgentRuns). Agents can't send, delete, touch credentials or run code: the tool
registry refuses such tools.

## Self-healing
Failures of background work (AI, n8n hand-offs) open a **recovery record**. The **Recovery Agent** (rules, no AI),
started by n8n WF5 every 5 minutes, retries temporary problems with backoff (5 → 10 → 20 min, max 4 tries, max 5
AI retries a day) and escalates permanent ones to a person. Details: [`self-healing.md`](self-healing.md).

## Security
Staff login (scrypt hash, signed HttpOnly cookie, 8 h), every non-public route locked (a test discovers routes and
checks each), n8n has its own key, security headers on the API and the page, rate limits, honeypot, no secrets in
logs. Details: [`security.md`](security.md).

## Deployment
Vercel: static frontend + the Express app as one serverless function; n8n on the developer's computer behind a
Cloudflare tunnel. Details: [`deployment.md`](deployment.md).

## Key decisions and trade-offs
| Decision | Why | Cost |
|---|---|---|
| Google Sheets as the database | Required by the brief; visible and editable by the business | No transactions, ~60 reads/min, slow beyond thousands of rows |
| Save first, AI in the background | The customer never waits for, or depends on, the AI | The dashboard polls for the result |
| Code-driven Orchestrator (not an AI deciding steps) | Predictable, testable, cheap | Less flexible |
| Rule-based Recovery Agent | Recovery must be predictable and safe | Only handles known problem kinds |
| Plain `fetch` for Gemini, own middleware for headers/limits | Few dependencies, every line understandable | More own code to test |
| One shared staff password | Simple for a small business | No per-person accounts or audit names |
| Simulated email delivery | No real customer gets an unapproved or test email | Not a real send yet |

## Known limitations
See the *Limitations* sections of `deployment.md`, `security.md`, `self-healing.md` and `ai-qualification.md`.
The biggest: in-process limits on serverless, n8n on one computer, Sheets as a database, the Gemini free tier
(20 requests/day).
