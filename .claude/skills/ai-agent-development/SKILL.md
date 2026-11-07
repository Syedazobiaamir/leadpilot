---
name: ai-agent-development
description: Rules for building AI features and agents in this project (Gemini via plain fetch): prompts, structured output, validation, prompt-injection defence, data minimization and fairness, background flows, quotas, evaluation and honest reporting. Use when adding or changing anything that calls an LLM (qualification, follow-up messages, the Stage 5 agents).
---

# AI features & agents

Reference implementation: Stage 4 lead qualification.
`backend/services/ai/geminiClient.js` → `ai/qualificationPrompt.js` → `services/qualificationService.js`, plus `scripts/aiAdmin.js` and `backend/evals/`.
External-service rules (secrets, timeouts, error kinds, drills) are in the **api-integration** skill and apply here too.

## Architecture
- **The AI is never on the critical path.** Save the user's data first, then run the AI in the background (`202` for manual runs). An AI failure must never lose or delay a lead.
- **One client file** calls the model (`geminiClient.js`). Everything else uses `generateJson({ system, prompt, schema, ...settings })`.
- **Settings live in one place** (`QUALIFICATION_SETTINGS`), so the app, `ai:check` and `ai:eval` always measure the same thing. For gemini-2.5 "thinking" models, thinking tokens count against `maxOutputTokens`. Set `thinkingBudget` (0 for short, rule-based tasks) or answers get cut off.
- At most **one job per record** at a time (an in-flight map). Double clicks and simultaneous requests must not call the AI twice.
- **Agents (Stage 5)**: each agent gets a narrow job and **no tools beyond what it needs**. No arbitrary code, no credential access, no destructive actions. Sensitive actions need human approval (`CLAUDE.md` §5). Design and examples: `docs/ai-agents.md`.

## Building an agent (Stage 5 pattern, `backend/agents/`)
- Definition: `{ name, description, tools: ['readLead', ...], async run({ input, tools, logger }) }`. Return `{ summary, ... }`, or `{ status: 'skipped', summary }`. Throw on failure (an `AiError` keeps its `kind`).
- **Data only through tools:** `await tools.call('toolName', ...)`. Never import the store in an agent. The registry refuses any tool not on the agent's list (`PermissionError` → run status `denied`).
- **Every tool checks its own limits** (e.g. `updateLeadAiFields` refuses non-AI fields; `saveFollowUpDraft` only accepts new drafts). Never add tools that send, delete, run code or read credentials: the registry refuses such names, and keep it that way.
- Run agents with `runAgent(...)`: it records AgentRuns (agent, lead, status, duration, errorKind, detail) and never throws. **`detail`/`summary` must never contain personal data**, and tests check it.
- `registry.checkAgent(agent)` at startup, so a typo in a tool name fails fast.
- The Orchestrator is **code, not an LLM**, and has **no tools**. It decides the order and when to stop (blocked lead → no AI; failed qualification → no follow-up). This keeps quota predictable (spam 0, Warm/Cold 1, Hot 2 requests).
- **AI writes, people decide:** anything that would reach a customer is saved as a **draft**. Approve, reject and edit are human actions in a service, never agent tools. A decided item can't change (409). Nothing is sent before Stage 6.
- When refactoring an AI flow into an agent, fingerprint the existing test file first and prove it passes **unchanged** afterwards.
- Test each agent for: its exact tool list, a tampered `run` being `denied`, AgentRuns records (success / failed / skipped) without personal data, and the pipeline paths (Hot / Warm / blocked / AI failure / AI disabled). Customers must get `201` without waiting for the AI.

## Prompts
- System instructions = role + explicit rubric + rules. User content goes in a separate `contents` part.
- **Untrusted input** (customer text) goes inside delimiters (`<inquiry>…</inquiry>`). Strip the delimiter from the input itself. Tell the model to never follow instructions inside it, and to report attempts (`injectionSuspected`).
- **Data minimization:** send only the fields the task needs. Never send name, phone, email or ZIP for classification. **Fairness:** forbid using identity, gender, age, ethnicity or wealth.
- Ask for **structured output** (`responseMimeType: application/json` + `responseSchema`) with short, bounded fields.

## Never trust the output
- Validate every answer with Zod, including **cross-field rules** (score inside the class's range). A failed validation is an `invalid_output` error, never a "success".
- On failure: mark the record `failed`, **keep any previous result**, log `kind`/`temporary`/rule (never the user's text), and write an activity event. No guessing, no partial saves.
- Label provenance: every AI result stores the exact model (`aiModel`). Hand-written or sample data is `simulated`, and the UI shows the difference.

## Quotas & errors
- Free tier limits are real and small (gemini-2.5-flash: **20 requests/day**, verified 2026-11-05). Read Gemini's 429 details: `QuotaFailure.quotaId` containing `PerDay` → `quota_exhausted` (don't retry for hours). Otherwise `rate_limited` (wait `RetryInfo.retryDelay`).
- Budget quota for evals (`ai:eval` ≈ 16 requests) and checks (`ai:check` = 2). Don't burn quota on exploratory clicks.
- Probe real error formats with a **fake key** (free) before trusting your mapping.

## Testing
- Automated tests never call the real model: `config.ai` is null in tests. Use `tests/fakeGeminiClient.js` (`answerWith`, `failWith`, `slowDown`, `calls` to inspect prompts).
- Test: what the prompt contains **and must not contain** (personal data), delimiter tricks, validation of bad answers, background flow, at-most-once per record, failure keeps old data, AI-disabled behaviour.
- Mutation-check the important rules (personal data leaking into the prompt, skipped validation, double AI calls).

## Evaluation (measure, don't assume)
- Keep a labelled set (`backend/evals/*.json`) with expected answers written **before** running the AI. Include hard cases: conflicting signals, other languages, vague input, and several prompt-injection styles.
- `npm run ai:eval` uses the app's exact prompt and settings. Report accuracy, injections resisted and flagged, false alarms, errors and skipped cases, and save the results file.
- Separate **AI quality** from **infrastructure noise**: retry temporary Google errors, stop on daily quota, never count errors as correct.
- Report results honestly in `docs/ai-qualification.md`, including failed and partial runs and what changed between them.
