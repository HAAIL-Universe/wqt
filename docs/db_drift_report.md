# DB Drift Report
Generated: 2025-12-27T19:17:05Z (UTC)
Source: docs/schema_inventory.md + code search results.

## Drift Items

1) users onboarding fields missing in DB
- Symptom: runtime error such as `column "default_shift_hours" does not exist` when /api/me reads or updates user profile.
- Root cause hypothesis: DB schema for `users` lacks onboarding columns present in code.
- Evidence:
  - wqt-backend/app/db.py:246-248 defines `default_shift_hours`, `onboarding_version`, `onboarding_completed_at`.
  - docs/schema_inventory.md:211-222 lists users columns and does not include those fields.
- Recommendation: add migration to add columns or remove code expectation.

2) shift_sessions.scheduled_start_at missing in DB
- Symptom: runtime error when code writes `scheduled_start_at` during shift start.
- Root cause hypothesis: DB schema lacks `scheduled_start_at` column.
- Evidence:
  - wqt-backend/app/db.py:146 defines `scheduled_start_at`.
  - docs/schema_inventory.md:158-184 lists shift_sessions columns without `scheduled_start_at`.
- Recommendation: add migration to add column or remove code usage.

3) perf_samples table present but unused in code (RESERVED)
- Symptom: table exists but no read/write paths in code; unclear ownership.
- Evidence:
  - docs/schema_inventory.md:133 shows `perf_samples` table.
  - `rg` search found no references in `wqt-backend` or `scripts`.
- Recommendation: mark as RESERVED (do not drop) until ownership is confirmed.

4) shift_sessions and orders columns mapped in code (RESOLVED)
- Evidence:
  - wqt-backend/app/db.py:154-160 maps shift_sessions zone_* + zone_id/zone_label.
  - wqt-backend/app/db.py:192-194 maps orders perf_score_ph/zone_id/zone_label.
- Recommendation: verify values are populated by writers or external processes.

5) order_events table defined but no usage found (RESERVED)
- Symptom: table exists and model is declared, but no ingestion queries found.
- Evidence:
  - wqt-backend/app/db.py:219 declares `order_events`.
  - docs/schema_inventory.md:68 shows `order_events` table.
  - No write/read usage found outside comments (e.g., wqt-backend/app/db.py:1114-1117 note only).
- Recommendation: mark as RESERVED (do not drop) until ingestion is defined.

## Endpoints tied to schema
- /api/shifts/start -> shift_sessions (wqt-backend/app/main.py:643)
- /api/orders/record -> orders (wqt-backend/app/main.py:1022)
- /api/me, /api/auth/* -> users (wqt-backend/app/main.py:199, 816, 865)
- /api/warehouse-map -> global_state (wqt-backend/app/main.py:1114)
- /api/state -> device_states (wqt-backend/app/main.py:440, 471)
