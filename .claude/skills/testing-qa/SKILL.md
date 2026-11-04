---
name: testing-qa
description: How to write, run and honestly report tests for this project (Vitest, React Testing Library; Supertest from Stage 2). Use when adding features, fixing bugs, or before declaring any feature complete.
---

# Testing & QA

## Tools
- **Vitest** is the test runner. Config is in `frontend/vite.config.js` (`test` section, jsdom environment).
- **React Testing Library** with `@testing-library/user-event` tests components the way a user uses them.
- **Supertest** (from Stage 2) tests Express API endpoints.

## Commands (run inside `frontend/`)
- `npm test` runs all tests once.
- `npm run test:watch` re-runs tests when files change.
- `npm run lint` and `npm run build` must also pass.

## What to test
- **Pure logic** (`validation/`, `utils/`): valid and invalid inputs, edge cases (empty list, divide by zero, bad dates).
- **Services**: validation is re-checked even if the UI is bypassed, plus duplicate protection and the created record's shape.
- **Components**: query by role or label (`getByRole`, `getByLabelText`), not CSS classes. Test error messages, success messages, and that filtering changes what's visible.
- Call `resetData()` in `beforeEach`, because the in-memory store is shared between tests.

## Honesty rules
- Paste the **real** test output. Never summarize results that weren't actually run.
- When a new test passes on the first run, break the code on purpose once to confirm the test can fail, then restore the code.
- Never weaken or delete a test just to make it pass. Fix the code, or explain why the test was wrong.
- Write down what is **not** tested (for example, visual layout, or real network failures before Stage 2).

## Manual end-to-end check
Automated tests don't replace actually using the app. Run `npm run dev`, go through the feature's checklist (see `frontend/README.md`), and ask the developer to confirm.
