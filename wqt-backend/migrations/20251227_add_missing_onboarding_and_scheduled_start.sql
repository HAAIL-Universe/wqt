-- Add missing onboarding and shift session columns (safe for existing rows).
-- Backfill plan (optional, not executed here):
--   1) UPDATE shift_sessions SET scheduled_start_at = date_trunc('hour', COALESCE(actual_login_at, started_at))
--      WHERE scheduled_start_at IS NULL;
--   2) UPDATE users SET onboarding_version = 0 WHERE onboarding_version IS NULL;
--   3) Leave default_shift_hours/onboarding_completed_at NULL unless historical values exist.
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_shift_hours INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_version INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;
