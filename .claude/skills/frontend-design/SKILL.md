---
name: frontend-design
description: Conventions for building and changing the React + Vite frontend in frontend/ (components, hooks, services, styling, accessibility). Use whenever adding or editing UI in this project.
---

# Frontend design (React + Vite)

## Where things go
- `src/components/<area>/` holds UI only. Components receive data and callbacks through props.
- `src/hooks/` holds state and loading logic (`useLeads`, `useMonitoring`). Hooks return `{ data, loading, error, ... }`.
- `src/services/` is the only place that fetches or stores data. Stage 1 uses in-memory sample data. From Stage 2 it calls the Express API with `fetch`, and components don't change.
- `src/validation/` holds Zod schemas, shared with the backend later.
- `src/utils/` holds pure functions (stats, formatting), with no React imports.
- `src/data/` holds sample data. Every file starts with a `SIMULATED DATA` comment.

## Rules
- Keep business logic out of components. If it can be computed, put it in `utils/` and test it.
- Every async screen handles **loading**, **empty** and **error** states. Never show an empty list when the real cause is an error.
- Forms validate on the client for quick feedback, and the service validates again. Never trust only the UI.
- Never show success unless the operation actually succeeded.
- Anything simulated must be labelled in the UI (see `SimulatedBanner`).
- No new UI or routing library without explaining why and getting approval. Navigation is currently page state in `App.jsx`.

## Styling
- Plain CSS. Design tokens live in `src/index.css` (`:root` variables, with dark mode via `prefers-color-scheme`).
- Component styles live in `src/App.css`, grouped by section. Reuse the existing classes: `card`, `field`, `badge-*`, `status-*`, `button-primary`.
- Mobile layout breakpoints are 720px and 900px. Check every new screen at phone width.

## Accessibility checklist
- Every input has a `<label htmlFor>`. Errors use `aria-invalid` and `aria-describedby`.
- Clickable things are `<button>`s, not `<div onClick>`.
- Success messages use `role="status"`. Errors use `role="alert"`.

## Done means
`npm run lint`, `npm test` and `npm run build` all pass (run them inside `frontend/`), and the change has been checked manually in `npm run dev`.
