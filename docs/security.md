# Security and monitoring (Stage 8)

**Goal:** only staff can see customer data; the public lead form can't be abused; the browser is told to
be strict; secrets never leak; every problem can be traced. Plus an operational report.

## Who can reach what
| Who | Can use | Protected by |
|---|---|---|
| **Anyone** (customers, visitors) | `POST /api/leads` (the lead form), `GET /api/health`, `GET /api/health/ready`, `/api/auth/*` | rate limits, honeypot, validation |
| **Staff** (logged in) | everything else: leads, follow-ups, activity, runs, recoveries, report | session cookie (`requireStaff`) |
| **n8n** | `/api/automation/*` only | its own `x-automation-key` (Stage 6) |

`backend/tests/auth.test.js` **reads every route from the source code** and checks that a visitor gets
`401` on every one that isn't on the public list. A new route that forgets the lock fails the test suite.

## Staff login (decision D1A)
- **One staff password.** Stored only as a **scrypt hash** (`STAFF_PASSWORD_HASH`): scrypt is deliberately
  slow and memory-hungry, with a random salt, so a stolen hash can't be guessed quickly. Compared in constant time.
- **Session = a signed cookie** `lp_session`: `{expiry, password fingerprint}` + an HMAC-SHA256 signature
  with `SESSION_SECRET`. Changing even one character breaks the signature → `401`.
  - `HttpOnly` (JavaScript can't read it, so a script injected into the page can't steal it)
  - `SameSite=Strict` (other websites can't make the browser send it: CSRF protection)
  - `Path=/api`, 8 hours, `Secure` in production (HTTPS only)
  - Changing the password ends every session (the fingerprint no longer matches).
- **Fail closed:** if the hash or secret is missing, staff routes answer `503 AUTH_NOT_CONFIGURED`, never open.
- **Guessing:** 5 login tries per 15 minutes per IP, then `429` (even for the right password).
- Set or change the password: `npm run auth:set-password` (in your own terminal; typing is hidden).
  To end ALL sessions at once without changing the password: change `SESSION_SECRET`.
- Dashboard: a login gate (`useAuth`). Nothing is requested before login; any `401 NOT_LOGGED_IN` (expired
  session) sends the person back to the login page with the reason.

## The public form
| Threat | Protection |
|---|---|
| Flooding with fake leads | **10 per minute per IP** (`429 RATE_LIMITED` + `Retry-After`) |
| Spam bots | **Honeypot:** a hidden `website` field people never see; filled in → `400 SUBMISSION_REJECTED` |
| Invalid / oversized data | Zod validation (Stage 2), 10 KB body limit |
| Double submissions | `Idempotency-Key` + one create at a time (Stage 7) |
| HTML/script in a message (XSS) | React shows it as text; no `dangerouslySetInnerHTML` anywhere (test: `Login.test.jsx`) |

## Browser rules (decision D2A: own middleware, `middleware/securityHeaders.js`)
`X-Content-Type-Options: nosniff` · `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` ·
`X-Frame-Options: DENY` · `Referrer-Policy: no-referrer` · `Cross-Origin-Resource-Policy: same-origin` ·
`Cache-Control: no-store` (responses hold customer data) · `Strict-Transport-Security` in production.
No `X-Powered-By`. These cover the API. Stage 9: the dashboard page gets its own from `vercel.json`: a CSP that
allows scripts and styles only from the site itself (no inline code), `frame-ancestors 'none'`, nosniff, DENY, HSTS,
Permissions-Policy. `tests/deployment.test.js` checks them; verified live.

## Protecting the Google Sheets quota
`/api/health/ready` reads 7 tabs (Google allows ~60 reads/minute). It is cached for 30 s, so calling it
fast can no longer exhaust the quota (found in a Stage 7 drill).

## Secrets
- All secrets live only in `backend/.env` (gitignored): Google key, Gemini key, `AUTOMATION_SECRET`,
  `STAFF_PASSWORD_HASH`, `SESSION_SECRET`. Setup scripts write them without printing them.
- The logger redacts fields named like secrets (password, token, key, cookie, authorization…).
- **Git history scan (2026-11-11):** all 7 commits; only placeholders and fake test keys; no `.env` or key file
  was ever committed.
- **`npm audit` (2026-11-11):** 0 known vulnerabilities (backend 170 packages, frontend 150).
- ⚠️ **Open risk:** the Google and Gemini keys were pasted into a chat on 2026-11-05. On 2026-11-13 the developer
  decided to keep and deploy them (not rotated), after being told the risk. Rotate any time with
  `npm run keys:import-google -- "<key.json>"` / `npm run keys:set-gemini`, then update Vercel's settings and redeploy.

## Monitoring
- **requestId on every log line:** the request runs inside an `AsyncLocalStorage` context; the logger adds the
  ID to every line, including deep storage errors and background work the request started.
- **Operational report** (`GET /api/reports/overview`, dashboard → Report): leads per day, classes, Hot share,
  median time form → AI answer, AI success and quota today (estimate, Pacific-time day), follow-ups, n8n runs,
  self-healing. Counts only, no personal data.

## Verified
**Automated:** 572 backend + 97 frontend tests (security, auth with the route-discovery lock check, report,
request context, login gate, XSS). Mutation checks for every protection (removing a lock, accepting forged
or expired cookies, no rate limit, no honeypot, no /ready cache, a missing header, unescaped HTML, …): all caught.

**Live drills** (2026-11-13, an isolated backend on port 3002 with the real password config, so the real
server's login was never locked): 14/14.

| Drill | Result |
|---|---|
| Visitor → all 13 staff endpoints | 401 each, no customer data in any refusal |
| n8n endpoint without its key | 401 |
| Right password | 200, cookie HttpOnly + SameSite=Strict + Path=/api + 8 h |
| Forged expiry, changed signature, garbage, missing signature | 401 each |
| Password guessing | 401 ×4, then 429; the right password then also 429 (Retry-After 899 s) |
| Honeypot / form flood | 400 SUBMISSION_REJECTED / 429 after 10 per minute |
| Headers | all present; no X-Powered-By, no HSTS on plain HTTP |
| Logs | no password, no cookie token; requestId on 45/45 warning lines |

Smoke test (real system, via the Vite proxy): 35/35, including the lock, headers, login, report and logout.

## Limitations
- Rate limits and the create queue live in ONE server process's memory: they reset on restart, and several
  instances (serverless) count separately. A shared store (e.g. Redis) or a database lock fixes that.
- Sessions are stateless: "log out" deletes the cookie in that browser; a copied cookie stays valid until it
  expires (8 h). Ending all sessions = change `SESSION_SECRET` or the password.
- One shared staff password, no user accounts or roles: the audit log can't say WHICH staff member did something.
- No CAPTCHA; the honeypot stops simple bots only.
- The public form page (`/request`, Stage 9) is open to everyone by design; it shows no data and only sends the form.
