-- Add server-computed shift start timestamps.
ALTER TABLE shift_sessions ADD COLUMN scheduled_start_at TIMESTAMPTZ;
ALTER TABLE shift_sessions ADD COLUMN actual_login_at TIMESTAMPTZ;
