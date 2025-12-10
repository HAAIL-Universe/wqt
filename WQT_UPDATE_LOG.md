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
