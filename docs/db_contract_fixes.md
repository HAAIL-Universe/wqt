# DB Contract Fixes
Generated: 2025-12-27T19:41:29Z (UTC)

## Mapped columns
- shift_sessions: zone_green_seconds, zone_amber_seconds, zone_red_seconds, zone_last, zone_last_at, zone_id, zone_label
  - Mapped in `wqt-backend/app/db.py` (ShiftSession model, serialize_shift_session, get_recent_shifts).
- orders: perf_score_ph, zone_id, zone_label
  - Mapped in `wqt-backend/app/db.py` (OrderRecord model, get_recent_orders_for_operator, get_history_for_operator).
