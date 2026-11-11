# n8n setup (Stage 6)

n8n runs **locally** on this computer (decision D1A): the global npm install, version **2.11.3**,
at <http://localhost:5678>. Its data (account, workflows, encrypted credentials, run history)
lives in `~/.n8n/`, not in this project. The workflow **definitions** are kept in Git in
`automation/workflows/*.json`, so they can be reviewed and re-imported.

## 1. Start the two servers
```
cd backend
npm run dev          # the API on :3001
```
```
n8n start            # n8n on :5678 (any folder; it always uses ~/.n8n)
```
Open <http://localhost:5678> and sign in with your existing n8n account.

On Windows, stopping `n8n start` or `npm run dev` with Ctrl+C can leave `node.exe` processes running. If
port 5678 or 3001 is still in use, end those processes in Task Manager.

## 2. The shared secret
`backend/.env` holds `AUTOMATION_SECRET` (64 random hex characters). n8n sends it in the header
`x-automation-key` whenever it calls `/api/automation/*`. Create it with:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Never paste it into chat, code or a workflow file.

## 3. The n8n credential "LeadPilot backend key"
Workflows reference a credential by ID (`lpAutomationKey1`), never the secret itself. n8n stores
credential values **encrypted** in `~/.n8n`, and exported workflow files contain only the ID.

Create it once, in the n8n UI: **Credentials → Create credential → Header Auth**
- Credential name: `LeadPilot backend key`
- Name: `x-automation-key`
- Value: the `AUTOMATION_SECRET` value from `backend/.env`

(On the developer's machine it was created with `n8n import:credentials` from a temporary file built
from `.env` and deleted right after, so the secret never appeared on screen. If you create it in the UI
instead, reopen each workflow's HTTP nodes and pick the credential.)

## 4. Import and publish a workflow
With **n8n stopped** (the CLI writes to n8n's database directly):
```
n8n import:workflow --input=automation/workflows/wf4-error-handler.json
n8n publish:workflow --id=lpWf4ErrorHand01
# then the same for wf3-health-monitor, wf2-send-followup, wf1-hot-lead-alert, wf5-recovery-sweep
```
Then start n8n. A **published** workflow runs on its own (schedule or webhook). In n8n 2.x, saving
an edit does not change the running version until you publish it again.

Your own workflows in the same n8n are untouched: ours all have IDs starting with `lp` and names
starting with `LeadPilot`.

## 5. Check it works
- n8n → **Executions**: WF3 runs every 5 minutes.
- Backend log: a `GET /api/health/ready` request every 5 minutes.
- `curl -H "x-automation-key: <secret>" http://localhost:3001/api/automation/check` → `200` (only for
  your own testing; don't put the secret in your shell history on shared machines).

## Workflows
| ID | Name | Trigger | Does |
|---|---|---|---|
| `lpWf1HotLeadAlrt` | LeadPilot WF1 - Hot-lead alert | Webhook `lead-qualified` | Hot lead → alert on the dashboard → record run |
| `lpWf2SendFollow1` | LeadPilot WF2 - Send approved follow-up | Webhook `followup-approved` | Claim (approved → sending) → SIMULATED delivery (dashboard note) → mark sent → record run |
| `lpWf3HealthMon01` | LeadPilot WF3 - Health monitor | Every 5 min | Checks `/api/health/ready`. ONE alert when it goes down (the run fails on purpose → WF4), ONE recorded run when it recovers. Quiet otherwise |
| `lpWf4ErrorHand01` | LeadPilot WF4 - Error handler | Any LeadPilot run fails | Escalation on the dashboard + run marked `escalated` (ignores non-`lp` workflows and n8n's sample data) |
| `lpWf5RecoverySwp` | LeadPilot WF5 - Recovery sweep | Every 5 min | Asks the backend's Recovery Agent to retry what failed (Stage 7) |

The backend sends events to n8n when `backend/.env` has `N8N_WEBHOOK_BASE_URL=http://localhost:5678/webhook`
(restart the backend after changing it). Webhooks only accept the `x-automation-key` header (Header Auth with
the same credential); anything else gets `403`. Import order: WF4 first (the others point to it as their error workflow).

Details per workflow: [`workflows.md`](workflows.md).
