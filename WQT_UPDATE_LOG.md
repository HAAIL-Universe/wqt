# WQT Update Log

## 2025-12-10 — Auth overhaul (log initialization)
- Established signed JWT-based authentication on the backend (python-jose) with bcrypt PIN hashing (passlib) and migration away from plain-text pins; introduced a single `get_current_user` dependency to validate `Authorization: Bearer <token>` and load users.
- Refactored all protected endpoints (state, shifts, orders, history) to ignore client-supplied operator/user IDs, binding reads and writes strictly to the authenticated user and logging `AUTH_DEBUG` / `HISTORY_DEBUG` for traceability.
- Updated state storage keys to use authenticated user identity and added per-user filtering across history/state to eliminate cross-user bleed.
- Frontend now stores the issued token after login/registration, injects `Authorization: Bearer <token>` via `fetchJSON`, removes user-id query/header usage for identity, and logs auth/history requests for debugging; login flows demand a token before proceeding.
- Requirements updated to include JWT + bcrypt libraries; persistent state logic keeps per-user caches while respecting authenticated identity.

This entry starts the continuous, authoritative update record maintained by CodexMax; all future changes will append here.

## 2025-12-10 — Auth user-creation hardening
- Enforced fail-fast startup when `DATABASE_URL` is missing; `init_db` now raises with a clear `[AUTH_INIT_ERROR]` instead of silently skipping engine setup.
- Refined `create_user` to return detailed outcomes (`db_not_initialised`, `username_exists`, `db_error`) and added robust commit rollback; `verify_user` logs when DB is uninitialised.
- Registration now validates roles against a strict whitelist (`picker`, `operative`, `supervisor`, `gm`) and surfaces precise errors for conflicts and DB issues.
- Maintained hashed-only PIN handling for new users; role spoofing and silent failures are blocked.

## 2025-12-10 — Bcrypt guardrails and dependency
- Added explicit `bcrypt==4.0.1` dependency to stabilise passlib backend on Render.
- Enforced PIN length bounds (4–32 chars) across register/login flows to avoid bcrypt 72-byte failures; hashing now defensively raises on over-length input.

## 2025-12-10 — State isolation for new users
- Disabled legacy device→user state migration in `/api/state`; authenticated users now load only their own per-user state and get a blank state if none exists, preventing cross-user history bleed when sharing devices.

## 2025-12-11 — Server-authoritative shift lifecycle
- Made shift start/end server-first: frontend now creates shift sessions via `/api/shifts/start`, persists the returned `shift_id`, and ends shifts only after `/api/shifts/end` succeeds; local state is cleared/archive only after backend confirmation, with clear error handling when offline.
- Added backend active-shift discovery (`/api/shifts/active`), reconciliation modal on load/login, and strict mismatch handling (resume server shift or end it immediately) to prevent split-brain states across devices.
- Extended `shift_sessions` to store duration, active minutes, and archived summaries with logging around start/end for observability; end-shift endpoint now validates ownership and records computed stats.
- Supervisor/GM views can rely on server truth via the new active-shift endpoint; manual test paths added for cross-device end-of-shift, offline end attempts, and fresh-login reconciliation.
