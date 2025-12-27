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

3) perf_samples table present but unused in code
- Symptom: table exists but no read/write paths in code; unclear ownership.
- Evidence:
  - docs/schema_inventory.md:133 shows `perf_samples` table.
  - `rg` search found no references in `wqt-backend` or `scripts`.
- Recommendation: confirm whether this is legacy or owned by an external process; document or deprecate.

4) shift_sessions and orders columns present in DB but not mapped in models
- Symptom: data may be written by other processes but ignored by current ORM models.
- Evidence:
  - docs/schema_inventory.md:175-182 lists shift_sessions zone_* and zone_id/zone_label columns not present in wqt-backend/app/db.py:145-155.
  - docs/schema_inventory.md:118-120 lists orders perf_score_ph/zone_id/zone_label not present in wqt-backend/app/db.py:190-201.
- Recommendation: either map these columns in models or document as legacy/external.

5) order_events table defined but no usage found
- Symptom: table exists and model is declared, but no ingestion queries found.
- Evidence:
  - wqt-backend/app/db.py:219 declares `order_events`.
  - docs/schema_inventory.md:68 shows `order_events` table.
  - No write/read usage found outside comments (e.g., wqt-backend/app/db.py:1114-1117 note only).
- Recommendation: either add ingestion paths or mark as legacy/unused.

## Endpoints tied to schema
- /api/shifts/start -> shift_sessions (wqt-backend/app/main.py:643)
- /api/orders/record -> orders (wqt-backend/app/main.py:1022)
- /api/me, /api/auth/* -> users (wqt-backend/app/main.py:199, 816, 865)
- /api/warehouse-map -> global_state (wqt-backend/app/main.py:1114)
- /api/state -> device_states (wqt-backend/app/main.py:440, 471)
