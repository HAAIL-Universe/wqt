# DB Migrations Index
Generated: 2025-12-27T19:17:28Z (UTC)

- wqt-backend/migrations/20251227_add_user_onboarding_fields.sql
  - Adds `users.default_shift_hours` (INTEGER), `users.onboarding_version` (INTEGER NOT NULL DEFAULT 0), `users.onboarding_completed_at` (TIMESTAMPTZ).
- wqt-backend/migrations/20251227_add_shift_session_start_fields.sql
  - Adds `shift_sessions.scheduled_start_at` (TIMESTAMPTZ) and `shift_sessions.actual_login_at` (TIMESTAMPTZ).
