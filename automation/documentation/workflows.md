# LeadPilot n8n workflows

Shared rules for every workflow:
- **The backend owns the data, n8n owns orchestration.** n8n never touches Google Sheets or Gemini.
  It only calls the backend's HTTP API, with the `LeadPilot backend key` credential.
- **No secrets in workflow files.** Credentials are referenced by ID; values stay encrypted in n8n.
- **Failures are visible.** A run that can't do its job fails (red in n8n's Executions), which
  triggers the error workflow (WF4) to escalate to a person.
- **Alerts go to the dashboard** (decision D3A, no Slack): n8n writes them to the activity log through
  `POST /api/automation/activity`. Limitation: nobody is *pushed* a notification; someone has to look.
- **Check incoming data**, even from our own backend: every webhook workflow starts with "Check the event".
- **Retries (Stage 7): only what can work.** Every backend call is an HTTP node with "Never error" + "Full
  response", so its Retry On Fail (3×, 5 s) only retries network failures (no answer). The `Check: <step>` node
  after it lets 2xx through and FAILS the run on anything else, labelled TEMPORARY (408/429/5xx) or PERMANENT
  (other 4xx, not retried). A permanent 404 now escalates in ~1 s instead of ~12 s of useless retries.
- **No ": " in thrown Code-node messages:** n8n only shows the text after the LAST ": " (found in a drill).

## WF1 - Hot-lead alert (`wf1-hot-lead-alert.json`)
```
Hot lead event (webhook lead-qualified, key checked) → Check the event → Alert on the dashboard → Record the run
```
The backend sends `lead.qualified` only for Hot leads, with the first name only. The alert reads
"HOT LEAD LD-1012: Linda, HVAC, timeline ASAP, score 95. Call them first. Why: ...".

## WF2 - Send approved follow-up, SIMULATED (`wf2-send-followup.json`)
```
Approved follow-up event → Check the event → Claim it → Check → Deliver or stop? → Simulated delivery → Check → Mark as sent → Check → Record the run → Check
  (webhook, key checked)     (delivery must      (approved →          claimed: deliver   (dashboard note)          (sending → sent,
                              be "simulated")     "sending")           not claimed: stop quietly                  idempotent)
```
**Claim first, deliver second (Stage 7).** The claim turns `approved` into `sending` and remembers the n8n run.
Only one run can win it, so a duplicate event can never deliver the email twice. Draft/rejected/missing → the
claim answers 4xx → PERMANENT → WF4. History: Stage 6 v1 delivered before checking anything (found by a drill);
Stage 6 v2 asked "still approved?" first; Stage 7 replaced that with the claim, which also closes the race between
two runs. If n8n stops between claim and mark-sent, the follow-up stays `sending` and the Recovery Agent escalates
it after 15 min (it MAY have been delivered, so it is never re-sent automatically).

## WF4 - Error handler (`wf4-error-handler.json`)
```
A LeadPilot workflow failed (Error Trigger) → Prepare the escalation → Escalate on the dashboard → Record the escalation → Did the dashboard get it?
```
WF1-WF3 have `errorWorkflow: lpWf4ErrorHand01` in their settings. The escalation reads
"NEEDS A PERSON: Send approved follow-up failed at "Ask: still approved?": ... (n8n run #21)", and the
failed run is marked `escalated`. URLs in error texts are hidden. When the backend itself is down (a WF3
outage), nothing can be written, so the last step fails WF4's own run on purpose: the escalation is then
only visible in n8n > Executions. An error workflow never triggers itself, so this can't loop.

## WF5 - Recovery sweep (`wf5-recovery-sweep.json`, Stage 7)
```
Every 5 minutes → Run the recovery sweep (POST /api/automation/recovery/sweep, 60 s) → Check → Did the sweep work?
```
n8n only TRIGGERS the backend's Recovery Agent (on Vercel the backend can't run its own timers); all rules and
limits live in the backend (`docs/self-healing.md`). A failed sweep fails the run → WF4. It records no run of its
own, and a sweep with nothing to do writes nothing (288 sweeps a day would flood the sheet).

## WF3 - Health monitor (`wf3-health-monitor.json`)

```
Every 5 minutes → Check backend readiness → Decide: alert, recovered or quiet → What happened?
                   GET /api/health/ready                                          ├─ alert     → Raise alert (fails this run) → WF4
                   (never error, full                                             └─ recovered → Record the outage (POST /api/automation/workflow-runs)
                    response, 3 tries)                                              (quiet / still_down → nothing)
```

| Readiness result | Meaning | WF3 does |
|---|---|---|
| `200` | Healthy | Nothing (quiet) |
| `503 STORAGE_UNAVAILABLE` etc. | Backend runs, but a dependency (Google Sheets) isn't usable | First time: **alert** |
| No answer (after 3 tries, 5 s apart) | Backend not running, or slower than 10 s | First time: **alert** |
| `200` after an alert | Recovered | **Record** one run: "Recovered: not ready for about N min (CODE)" |

Design decisions:
- **One alert per outage, not one every 5 minutes.** The Code node remembers the outage in workflow
  static data (`$getWorkflowStaticData`). Static data is only saved for automatic (published) runs,
  not when you click "Execute workflow" by hand, so manual test runs always behave like "first time".
- **The monitor doesn't depend on what it monitors.** While the backend is down it can't store anything,
  so the alert goes through n8n itself (a failed run → WF4, visible in n8n > Executions). The run is recorded in the backend
  only after recovery.
- **Retries only for "no answer".** A `503` is a clear answer, so it isn't retried; a connection
  failure might be a blip, so it's tried 3 times before alerting.
- `/api/health/ready` needs no key: it reveals nothing sensitive.

Limitations: if n8n itself is down, nothing monitors anything (in production you'd use an outside
uptime service as well). The outage duration is rounded and measured in 5-minute steps.

## Live verification (2026-11-09, real n8n + real Google Sheet, SIMULATED data)
| Check | Result |
|---|---|
| WF3 drill: healthy → down → still down → back | quiet → 1 alert (run #12) → quiet (#13) → recovery saved `WF-n8n-14` |
| Webhooks without the key / with a wrong key | `403`, no run started |
| Approve draft FU-mw651p8n-0b5b (LD-1013) | ~2 s later: SIMULATED note, status `sent` (`sentVia: simulated`), run `WF-n8n-17` |
| Re-qualify LD-1012 (1 Gemini request) | Hot 95 → "HOT LEAD LD-1012: Linda, ..." on the dashboard, run `WF-n8n-18` |
| Event for a follow-up that doesn't exist (v1 of WF2) | **Bug found:** delivery note written before the check; escalated after mark-sent failed (#19 → #20) |
| Same, after the fix | Stopped at "Ask: still approved?", no delivery note, escalated (#21 → #23) |
| Duplicate event for the already-sent follow-up | Stopped quietly (#22), nothing delivered twice |

The activity log still contains the misleading "SIMULATED email for follow-up FU-DRILL-DOES-NOT-EXIST" note
from the first drill (before the fix). It was left in place as an honest record.

## Live verification, Stage 7 (2026-11-11)
| Check | Result |
|---|---|
| n8n stopped, follow-up FU-mwc9urss-4538 approved | record `pending_retry` → n8n back → sweep → claimed by run #43 → sent → "Recovered … after 2 tries" |
| The same event again | run #44 stopped quietly (claimed: false), nothing delivered twice |
| Event for a missing follow-up | "Check: Claim it" → PERMANENT 404 in 1.2 s → WF4 (#47), full message visible after the ": " fix |
| WF5 on schedule | run #54 → sweep 200 in 1.6 s, nothing to do |
| n8n "Execute workflow" on WF4 (sample data) | ignored since the `lp` filter (earlier it had written a fake "Example Workflow" escalation: EV-n8n-29 / WF-n8n-231 in the sheet) |
