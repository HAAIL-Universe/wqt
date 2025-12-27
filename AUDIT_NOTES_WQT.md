2025-12-27: Added migration `wqt-backend/migrations/20251227_add_user_onboarding_fields.sql` to alter `users` with `default_shift_hours` (INTEGER, nullable), `onboarding_version` (INTEGER NOT NULL DEFAULT 0), `onboarding_completed_at` (TIMESTAMPTZ, nullable).
2025-12-27: Added migration wqt-backend/migrations/20251227_add_shift_session_start_fields.sql to alter shift_sessions with scheduled_start_at (TIMESTAMPTZ, nullable) and ctual_login_at (TIMESTAMPTZ, nullable).
2025-12-27: UI state machine update (onboarding/shift_home/shift_active).
- Branch/SHA: chore/db-schema-audit / 488f593cceaf72bed2de351affa10c6626f39662
- Repro steps: Not captured in this environment (no browser session).
- Console first error: Not captured.
- Network (scripts/failed requests): Not captured.
- Classification: Not captured (code-only change request).
2025-12-27: Resume shift state transition fix.
- Branch/SHA: chore/db-schema-audit / a2c27864552e5866c25cd003c3737250f8cd448a
- Repro steps: Login → onboarding select shift length → Start shift → Refresh during active shift → End shift → Logout/login → Resume shift should land on shift_active.
- Console first error: None reported.
- Network (scripts/failed requests): None reported.
- Classification: C) Init never called / handlers not bound (resume handler did not assert UI state to shift_active).
- Root cause: `scripts/boot.js` resume handler omits explicit UI state transition when resuming a server-active shift.
2025-12-27: Onboarding repair mode for missing shift length.
- Branch/SHA: chore/db-schema-audit / 51ea1d88a297eb7b04fd875f9fb5c0625c7b5647
- Repro steps: User has onboarding_completed_at set and onboarding_version >= ONBOARDING_VERSION; user.default_shift_hours is NULL/invalid.
- Console first error: None reported.
- Network (scripts/failed requests): None reported.
- Classification: E) Gating deadlock (onboarding gate allowed incomplete data; UI fell back to 9h).
- Root cause: Onboarding gate treated completion as sufficient without validating shift length, allowing silent fallback.
- Fix summary: Trigger onboarding card in repair mode to collect contracted shift length; prevents silent 9h fallback.
2025-12-27: Header state sync for shift_home vs shift_active.
- Branch/SHA: chore/db-schema-audit / c94b6e7af57cfef40945dd09ba37c98b9933839c
- Repro steps: Login → Start shift (order header visible) → End shift (order header should hide, home header should show) → Refresh on shift_home (home header persists).
- Console first error: None reported.
- Network (scripts/failed requests): None reported.
- Classification: C) Init not called / handlers not bound (header not wired to setWqtShiftUiState).
- Root cause: Order header lived outside any UI-state switch, so shift_home still showed the order header on end/refresh.
- Fix summary: Add explicit header containers and toggle them in setWqtShiftUiState.
