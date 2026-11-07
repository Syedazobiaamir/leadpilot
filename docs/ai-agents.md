# AI Agent Architecture (Stage 5)

Four logical agents, each with **one job** and **limited permissions**, coordinated by a code-driven Orchestrator.
Built on top of the Stage 4 AI qualification ([`ai-qualification.md`](ai-qualification.md)).

```
New lead saved ✅ → 201 to the customer right away
        │
        ▼ background
  🎛️ Orchestrator  (code, NOT an AI; has NO tools: it only calls agents)
        ├─1─► 🔍 Validation Agent     rules only, no AI
        │        └─ blocked (test/spam)? → stop: no AI quota spent
        ├─2─► 🎯 Qualification Agent  Gemini → Hot / Warm / Cold
        │        └─ failed? → stop (the lead can be retried)
        └─3─► ✉️ Follow-up Agent      Hot only → email DRAFT that needs human approval
  Every step is recorded in AgentRuns.
```
AI requests per new lead: **spam/test = 0**, **Warm/Cold = 1**, **Hot = 2**.

| File | Job |
|---|---|
| `backend/agents/toolRegistry.js` | The gatekeeper: an agent can only call tools on its own list (`PermissionError` otherwise). Refuses to register tools whose names suggest sending, deleting, credentials or running code |
| `backend/agents/tools.js` | The tools. Each one also checks its own limits |
| `backend/agents/runAgent.js` | Runs one agent and records the run (agent, lead, status, duration, error kind, summary). Never throws for an agent failure |
| `backend/agents/validationAgent.js` | Validation Agent + its rules (`checkLeadQuality`) |
| `backend/agents/qualificationAgent.js` | Lead Qualification Agent (Stage 4 logic, now via tools) |
| `backend/agents/followUpAgent.js` | Follow-up Agent |
| `backend/agents/orchestrator.js` | The Orchestrator |
| `backend/services/followUpService.js` | Draft requests (background) and the **human** decisions: approve / reject / edit |

## Permissions (least privilege)

| Agent | Tools | Cannot |
|---|---|---|
| Orchestrator | *(none)* | touch any data itself |
| Validation | `readLead`, `setReviewFlags`, `writeActivity` | change AI fields or contact details, use AI |
| Qualification | `readLead`, `updateLeadAiFields`, `writeActivity` | change contact details or sales status (the tool refuses anything but AI fields), draft or send messages |
| Follow-up | `readLead`, `listFollowUps`, `saveFollowUpDraft`, `writeActivity` | change the lead, approve or edit a draft (`saveFollowUpDraft` only accepts new drafts), send anything |

**Defence in depth:** (1) the registry checks the agent's tool list, (2) each tool checks its own limits, (3) dangerous tools **do not exist**: there is no send, delete, credentials or code-execution tool, so no bug or prompt can give an agent that power. All three are covered by tests and mutation checks.

## Validation Agent (rules, no AI)
Sets `reviewFlags` on the lead; it never deletes or rejects a lead.

| Flag | Severity | Example |
|---|---|---|
| `test_or_placeholder` | **block** | name "Test User", "John Doe", "Smoke Test"; message "test test", "lorem ipsum", "safe to ignore" |
| `spam_content` | **block** | SEO/backlink/crypto/casino/loan offers, or 2+ links |
| `contains_link` | review | one link (maybe a photo of the damage) |
| `too_vague` | review | under 4 words, or a short generic request ("I need a quote") |
| `all_caps`, `repeated_characters`, `suspicious_phone`, `disposable_email` | review | shouting, "!!!!!!!", 123-456-7890, mailinator.com |

**Block** = the Orchestrator skips the AI. **Review** = the AI still runs, and the UI shows "Needs review".
False positives were checked: none of the 10 sample leads, the 16 qualification-eval messages or Linda's real lead are blocked. Testing found and fixed one false positive ("Roof leak after storm." was "vague") and one false negative (our own "Smoke Test" lead was not caught).

## Follow-up Agent (AI drafts, human approval)
- **Data minimization:** the AI gets the **first name only**, service, timeline, class and the message (never last name, phone, email or ZIP). The message stays untrusted, between `<inquiry>` tags.
- **Guardrails in code** (`followUpDraftSchema`): no money amounts, percentages, discounts or deals, "free" offers, guarantees or warranties, promised times ("within 30 minutes", "tomorrow", "9am") or placeholders (`[Name]`). It must greet the customer's first name and be signed with the business name (`CONTRACTOR_NAME`, fictional by default). Max ~120 words. "Feel free to reply" is allowed; "free inspection" is not.
- One open draft per lead (extra requests are recorded as `skipped`, and no AI quota is spent).
- **Draft life cycle:** `draft` → (person) **approve** → `approved` · **reject** → `rejected` · **edit** → still `draft` (+`editedAt`). After a decision nothing can change (`409`). A person's edit is only checked for shape and length: a person may write things the AI may not, and takes responsibility.
- **Nothing is sent in Stage 5.** Approved drafts will be sent by n8n in Stage 6.

First real drafts (2026-11-07, fictional leads): Linda Park (furnace, newborn) and Carlos Rivera (storm roof damage). Both greeted by first name, acknowledged the urgency, made no price or time promises, and were signed by the business.

## AgentRuns (audit trail)
One row per agent run, in the `AgentRuns` Sheet tab and `GET /api/agent-runs`: `runId, leadId, agent, status (success | skipped | failed | denied), durationMs, errorKind, detail, startedAt`.
The `detail` never contains personal data (only outcomes like `Hot (score 95)` or `draft FU-...`). Tests check this for every agent.

Example (real, 2026-11-07):
```
orchestrator  success  validation: ok → qualification: Hot 95 → followup: draft FU-mw651p8n-0b5b
validation    success  no issues
qualification success  Hot (score 95)
followup      success  draft FU-mw651p8n-0b5b
orchestrator  success  validation: blocked → qualification: skipped (blocked lead, no AI used)
```

## Verification
- **378 backend + 72 frontend tests**, including permission tests (an agent using a tool not on its list, a tool asked to change forbidden fields, dangerous tool names refused), the unchanged Stage 4 qualification tests (file fingerprint checked before and after the refactor), and a backend/frontend sync test for flag codes.
- **Mutation checks** for every rule above (all caught).
- **Live (2026-11-07):** a Hot lead went through all three agents (2 AI requests), and a test lead was blocked with **0** AI requests.
- **Failure drills** (separate server, memory store, no quota used):

| Drill | Customer | Pipeline |
|---|---|---|
| Wrong Gemini key | 201 in ~35 ms | qualification `auth` → stops, no follow-up attempt |
| Gemini unreachable | 201 | `unavailable` → stops |
| Gemini never answers | 201 | `timeout` after 6 s → stops |
| AI disabled | 201 | "skipped (AI disabled)"; follow-up request → `503 AI_UNAVAILABLE` |
| Spam lead + wrong key | 201 | blocked, **no AI call at all** (no AI error in the log) |

No API key appeared in any log.

- **Follow-up eval** (`npm run ai:eval-followup`, 8 cases incl. Spanish and 2 injection attempts): **pending**, to run when the free daily quota allows (~8 requests).

## Limitations
- Nothing is sent yet (Stage 6, n8n). Approvals are not tied to a user (no login until Stage 8).
- No automatic retries of failed agents (Stage 7, Recovery Agent).
- The Validation Agent's rules are simple patterns: English-centric, and they can miss clever spam or flag unusual real messages (only "block" flags skip the AI, and a person can still run it).
- The guardrails are English patterns. A Spanish draft promising "mañana" would not be caught (the human approval step remains the safety net).
- Free tier: ~10 Hot leads/day (20 AI requests/day).
