# Case study: LeadPilot

*AI lead management and self-healing automation for US home-improvement contractors.*
Live: https://leadpilot-lac-psi.vercel.app · Code: this repository · Built in 9 stages (Nov 2026).

## The problem
A small contractor gets leads from a website, ads and phone calls. Leads wait for hours, urgent jobs (a leaking
roof) look the same as "maybe next year", follow-ups are forgotten, and when an automation silently breaks, nobody
notices until a customer complains.

## What I built
| Need | Solution |
|---|---|
| Capture leads safely | Public form + staff form; the same Zod schema in the browser and on the server; duplicate, double-submit (Idempotency-Key), bot (honeypot) and flood (rate limit) protection |
| Know which lead is urgent | A Qualification Agent (Gemini) returns Hot / Warm / Cold, a score and a reason, as schema-checked JSON |
| Answer fast but safely | A Follow-up Agent drafts an email; a person approves, edits or rejects it |
| Run the routine work | n8n workflows: Hot-lead alert, sending (simulated), health monitor, error handler, recovery sweep |
| Survive failures | Recovery records + a rule-based Recovery Agent: backoff 5 → 10 → 20 min, max 4 tries, escalation to a person |
| See what happens | Dashboard: leads, AI panel, agent runs, workflow runs, audit log, self-healing, operational report |

Stack: React + Vite, Node.js + Express, Zod, Google Sheets API, Gemini API, n8n, Vitest / React Testing Library /
Supertest, Vercel, Cloudflare tunnel. Architecture: [`architecture.md`](architecture.md).

## Design choices I can defend
- **Save first, AI later.** The customer gets an answer in milliseconds; AI runs in the background. If Gemini is
  down or out of quota, the lead is still safe and the self-healing retries it later.
- **AI gets the minimum.** Only service, timeline and message: no name, phone, email or ZIP (privacy, and no
  bias from names or neighbourhoods).
- **Agents with limited permissions.** A tool registry refuses any tool that could send, delete, touch credentials
  or run code. The Orchestrator and the Recovery Agent are code, not AI: predictable and testable.
- **A person approves every customer message.** Delivery is simulated until a real email provider is approved.
- **Few dependencies.** Plain `fetch` for Gemini, own middleware for security headers and rate limits: every line
  can be explained.

## Bugs that testing found (the most useful part)
| Found by | Problem | Fix |
|---|---|---|
| Failure drill: "Google never answers" | The Google library's timeout did not cover getting the login token: requests hung for 30+ s | Our own deadline on every Google call (8 s, shorter than the browser's 10 s) |
| AI evaluation run 1 (6/16) | Gemini 2.5's hidden "thinking" used 487 of 512 output tokens, so JSON answers were cut off | Thinking off → run 3: **16/16**, 3/3 prompt injections resisted and flagged, ~2× faster |
| Live n8n drill | WF2 delivered a follow-up BEFORE checking its status | Check first; later a claim step so only one run can send |
| Concurrency test with a slow fake store | 5 identical form posts at once created several leads | One-create-at-a-time queue + Idempotency-Key replay |
| Live drill | n8n shows only the text after the LAST ": " of an error | A generator rule: no ": " in thrown messages |
| Polling the readiness check every 2 s | 7 Sheets reads per call hit Google's 60 reads/minute limit | Readiness result cached for 30 s |
| Report on real data | "Median time to qualify" was 2,866 minutes because hand re-runs counted | Median of automatic answers only (0.1 min) |
| First Vercel deploy | `503`: the setup script copied only the first line of a multi-line private key | Reproduced by running the built function locally; fixed the copy |
| Mutation checks | Several tests passed even with the protection removed | Tests rewritten until breaking the code made them fail |

## Results (with evidence)
- **584 backend + 102 frontend automated tests**; the security and self-healing protections were mutation-checked.
- **Smoke test 36/36** against a Vercel preview deployment; **security drills 15/16** on Vercel (locks, forged
  cookies, password guessing, honeypot, flood, headers, HTTPS-only cookie; the one miss was an n8n route answering
  503 "not configured" instead of 401 on the preview, closed either way).
- **AI evaluation:** qualification 16/16, follow-up drafts 8/8, prompt injection resisted 5/5 across both.
- Live production checks and n8n → live-site runs succeeded. Details: [`deployment.md`](deployment.md),
  [`testing.md`](testing.md).

## Limitations (honest)
- Google Sheets is not a real database (no transactions, ~60 reads/min).
- On serverless, rate limits and the duplicate queue live in each instance's memory.
- n8n runs on one computer behind a tunnel; email delivery is simulated.
- Free tiers: Vercel Hobby (non-commercial), Gemini 20 requests/day.

## What I would do next
1. Move data to a real database (e.g. Postgres) with a unique constraint for duplicates and transactions.
2. A shared store (e.g. Redis) for rate limits and sessions across instances.
3. Host n8n permanently and connect a real email provider, still with human approval.
4. Per-person staff accounts and roles, so the audit log says who did what.

## What I learned
Plan before building; test the unhappy paths (most real bugs above were found by failure drills, not by happy
tests); never report a result I did not see; and keep AI behind clear rules — schema-checked output, minimal data,
human approval for anything a customer will see.
