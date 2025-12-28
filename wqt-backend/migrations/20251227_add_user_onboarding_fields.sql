-- Add onboarding fields to users.
ALTER TABLE users ADD COLUMN default_shift_hours INTEGER;
ALTER TABLE users ADD COLUMN onboarding_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
