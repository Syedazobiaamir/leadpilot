---
name: api-development
description: Conventions for building and changing the Express REST API in backend/ (routes, controllers, services, store, middleware, errors, logging, validation). Use whenever adding or editing an API endpoint or backend logic.
---

# API development (Node.js + Express 5)

## Layers: one job each
| Layer | Folder | Rule |
|---|---|---|
| Route | `routes/` | Only maps method + URL → controller. Mount new routers in `app.js` **before** `notFound` |
| Controller | `controllers/` | Read `req`, call ONE service function, send the response. No business rules, no `try/catch` (Express 5 forwards async errors to `errorHandler`) |
| Service | `services/*Service.js` | Business rules. No `req`/`res`. Throw `AppError` for expected failures. Agents (Stage 5) will call services directly |
| Store | `services/leadStore.js` | The ONLY file that knows where data lives. Async functions that return **copies**. Google Sheets replaces its internals in Stage 3 |

## Responses
- Success: `{ data }`, or `{ data, count }` for lists. Create returns `201` + a `Location` header.
- Errors: always `throw new AppError(status, CODE, message, details?)`. Never call `res.status(4xx).json(...)` by hand. `errorHandler` builds `{ error: { code, message, details?, requestId } }`.
- Add every new error code to the reference table in `docs/api-documentation.md`, marked **permanent** or **temporary**. Permanent errors (validation, not found, duplicate) must never be retried.
- Unexpected errors → generic `500 INTERNAL_ERROR`. Never put internal details in the response.

## Validation
- Validate every external input (body, params, query) in the service before it reaches the store.
- Lead rules live in `validation/leadSchema.js`, an **identical copy** of `frontend/src/validation/leadSchema.js`. Edit both. `tests/schemaSync.test.js` enforces this.
- Zod strips unknown fields. Never let clients set system fields (`id`, `status`, `classification`, `score`, `createdAt`).
- Public endpoints must not reveal other customers' data (e.g. the duplicate error doesn't say which lead matched).

## Logging & config
- Use `logger` from `utils/logger.js` (structured JSON), never `console.log`, except in `server.js` startup messages.
- Include `requestId` in log fields. Never log request bodies, query strings, personal data or secrets.
- Read environment variables only in `config.js`. Document each new one in `.env.example` and the backend README. Never commit `.env`.

## Dependencies
Current: `express`, `zod`; dev: `vitest`, `supertest`. Ask before adding anything, and explain why it's needed.

## Done means
1. Supertest tests cover success and every error code of the endpoint (see the `testing-qa` skill).
2. `npm test` passes in `backend/`, and in `frontend/` too if shared files changed.
3. `npm run smoke` passes with both servers running.
4. `docs/api-documentation.md` is updated.
