2025-12-27: Added migration `wqt-backend/migrations/20251227_add_user_onboarding_fields.sql` to alter `users` with `default_shift_hours` (INTEGER, nullable), `onboarding_version` (INTEGER NOT NULL DEFAULT 0), `onboarding_completed_at` (TIMESTAMPTZ, nullable).
2025-12-27: Added migration wqt-backend/migrations/20251227_add_shift_session_start_fields.sql to alter shift_sessions with scheduled_start_at (TIMESTAMPTZ, nullable) and ctual_login_at (TIMESTAMPTZ, nullable).
2025-12-27: UI state machine update (onboarding/shift_home/shift_active).
- Branch/SHA: chore/db-schema-audit / 488f593cceaf72bed2de351affa10c6626f39662
- Repro steps: Not captured in this environment (no browser session).
- Console first error: Not captured.
- Network (scripts/failed requests): Not captured.
- Classification: Not captured (code-only change request).
