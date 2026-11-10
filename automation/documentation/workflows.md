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
- **Retries:** every backend call is tried up to 3 times, 5 s apart. Known limitation: n8n's "Retry On Fail"
  also retries permanent errors (e.g. `404`), which wastes ~10 s before escalating. Stage 7 limits retries
  to temporary errors.

## WF1 - Hot-lead alert (`wf1-hot-lead-alert.json`)
```
Hot lead event (webhook lead-qualified, key checked) → Check the event → Alert on the dashboard → Record the run
```
The backend sends `lead.qualified` only for Hot leads, with the first name only. The alert reads
"HOT LEAD LD-1012: Linda, HVAC, timeline ASAP, score 95. Call them first. Why: ...".

## WF2 - Send approved follow-up, SIMULATED (`wf2-send-followup.json`)
```
Approved follow-up event → Check the event → Ask: still approved? → Deliver or stop? → Simulated delivery → Mark as sent → Record the run
  (webhook, key checked)     (delivery must      (GET status)          approved: deliver   (dashboard note)  (idempotent)
                              be "simulated")                          sent: stop quietly
                                                                       other: fail → WF4
```
**Check first, deliver second.** The first version delivered before asking the backend, and a drill showed
it would "deliver" a follow-up that didn't exist. Now the backend's status decides: a duplicate event for an
already-sent follow-up stops quietly (the customer never gets it twice), and a draft/rejected/missing one is
never delivered. Remaining gap (Stage 7): if n8n crashes between delivery and mark-sent, the follow-up stays
`approved`, and a re-sent event would deliver it again.

## WF4 - Error handler (`wf4-error-handler.json`)
```
A LeadPilot workflow failed (Error Trigger) → Prepare the escalation → Escalate on the dashboard → Record the escalation → Did the dashboard get it?
```
WF1-WF3 have `errorWorkflow: lpWf4ErrorHand01` in their settings. The escalation reads
"NEEDS A PERSON: Send approved follow-up failed at "Ask: still approved?": ... (n8n run #21)", and the
failed run is marked `escalated`. URLs in error texts are hidden. When the backend itself is down (a WF3
outage), nothing can be written, so the last step fails WF4's own run on purpose: the escalation is then
only visible in n8n > Executions. An error workflow never triggers itself, so this can't loop.

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
