---
name: n8n-automation
description: Rules for building and changing the n8n workflows (automation/workflows/*.json) and the backend side of automation (automationClient, automationService, /api/automation/*): events, webhooks, the shared key, idempotency, error workflow, import/publish, and live drills. Use whenever adding or changing an n8n workflow, an event the backend sends, or an endpoint n8n calls.
---

# n8n automation (Stage 6)

Setup: `automation/documentation/n8n-setup.md`. Workflow design and drill results:
`automation/documentation/workflows.md`. API: `docs/api-documentation.md` (Automation endpoints, Events).

## Who does what
- **The backend owns the data and the rules. n8n owns orchestration** (triggers, schedules, retries,
  calling outside services). n8n never touches Google Sheets or Gemini directly: it only calls
  `/api/automation/*`.
- **Backend → n8n:** `automationClient.js` is the ONLY file that calls n8n. Only the events in
  `EVENT_PATHS` exist. Events are sent in the background with a 5 s deadline. If n8n is down, the user's
  action still succeeds and a `failed` run (`WF-be-...`) is recorded. Never block or fail a request on n8n.
- **n8n → backend:** only `/api/automation/*`, behind `requireAutomationKey` (header `x-automation-key`,
  constant-time compare). The dashboard never calls these.

## Rules for every workflow
1. **IDs and names:** id `lp` + 14 characters (n8n IDs are 16), name `LeadPilot WFn - ...`. The developer's
   n8n also holds their OWN workflows: never touch, export or overwrite those.
2. **No secrets in workflow JSON.** Use credentials by ID: `LeadPilot backend key` (Header Auth,
   `lpAutomationKey1`) for the backend and for webhook auth. Never put a key or token in a URL, header
   parameter or Code node.
3. **Webhooks use Header Auth** with that credential (wrong or missing key → 403).
4. **First node after a trigger checks the event** (type, ID formats, allowed values) and throws a clear
   error otherwise. Never trust incoming data, even from our own backend.
5. **Check first, act second.** Before any action with an outside effect (sending), ask the backend for
   the current status (e.g. `GET /api/automation/followups/:id`). Already done → stop quietly (duplicate).
   Not allowed → fail (escalate). A drill found WF2 "delivering" before checking; don't repeat it.
6. **Every backend write n8n makes must be idempotent**, keyed by `$execution.id` (`WF-n8n-<id>`,
   `EV-n8n-<id>`) or by the record's own state (mark-sent). n8n retries; duplicates must be impossible.
7. **Data minimization:** events carry first names only. No phone, email, last name or ZIP leaves the backend.
8. **Hide URLs in error texts** (`cleanErrorText` in the backend, `clean()` in WF4): a webhook URL can be a secret.
9. **Every workflow except WF4 sets `settings.errorWorkflow: lpWf4ErrorHand01`.** A run that can't do its job
   must FAIL (red), never end green. WF4 escalates on the dashboard and fails visibly itself if the
   backend is unreachable.
10. **Simulated means labelled.** Delivery is SIMULATED in Stage 6 (`delivery: "simulated"`, `sentVia:
    "simulated"`). A real channel needs explicit approval, a credential check, and a new decision in CLAUDE.md.
11. **Retries (Stage 7):** every backend call is an HTTP node with "Never error" + "Full response" (so Retry On
    Fail, 3 tries, 5 s, only retries real network failures) followed by a `Check: <step>` Code node: 2xx passes,
    anything else FAILS the run labelled TEMPORARY (408/429/5xx) or PERMANENT (other 4xx, never retried).
    Lost hand-offs are retried later by the backend's Recovery Agent, not by n8n. Don't retry anything endlessly.
12. **Claim before acting on the outside world** (WF2): `claim` (approved → sending) first; `claimed: false` =
    duplicate → stop quietly. A follow-up stuck in "sending" is escalated, never re-sent.
13. **No ": " inside a thrown error message in a Code node.** n8n only shows the text after the LAST ": ",
    so the start of the message disappears. Use " - " instead.

## Changing a workflow
- Workflow files in `automation/workflows/` are the source of truth (kept in Git). Edit the JSON (or change it
  in the n8n editor and export it back), then re-import:
  1. stop n8n (on Windows also end leftover `node.exe` n8n processes),
  2. `n8n import:workflow --input=automation/workflows/<file>.json`,
  3. `n8n publish:workflow --id=<id>` (n8n 2.x: saved ≠ live until published),
  4. `n8n start` and check the log says `Activated workflow "LeadPilot ..."`.
- Syntax-check Code nodes (`new Function(code)`) and run their logic with sample inputs before importing.
- n8n's run history can be read **read-only** from `~/.n8n/database.sqlite` (`execution_entity`,
  `execution_data`) with `node:sqlite`. Never write to that database.

## Testing
- Backend: Supertest in `backend/tests/automation.test.js` with a FAKE automation client and a fake `fetch`.
  No test may reach a real n8n (`config.automation` is forced off in tests).
- Frontend: `installFakeApi({ n8n: 'sends' | 'off' })` simulates WF2.
- Live (n8n running): webhook without/with a wrong key → 403; the happy path of each workflow; at least one
  forced failure per workflow → WF4 escalation; a duplicate event → no double action. Record results in
  `workflows.md` with run numbers, including bugs found. Drill events go to SIMULATED data only.
