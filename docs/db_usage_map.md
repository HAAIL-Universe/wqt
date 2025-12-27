# DB Usage Map
Generated: 2025-12-27T19:16:35Z (UTC)
Source tables: SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
Method: code search (rg/Select-String) across `wqt-backend` and `scripts`.

## admin_messages
Status: ACTIVE
Evidence:
- wqt-backend/app/db.py:465 `msg = AdminMessage(device_id=device_id, message_text=text)`
- wqt-backend/app/main.py:603 `@app.post("/api/admin/message")`
- wqt-backend/app/main.py:612 `@app.get("/api/messages/check")`
- scripts/boot.js:950 `fetch(.../api/messages/check?device-id=...)`

## device_states
Status: ACTIVE
Evidence:
- wqt-backend/app/db.py:320 `session.query(DeviceState).filter(DeviceState.device_id == device_id)`
- wqt-backend/app/main.py:440 `@app.get("/api/state", response_model=MainState)`
- wqt-backend/app/main.py:471 `@app.post("/api/state", response_model=MainState)`
- scripts/api.js:324 `fetchJSON(`/api/state${qs}`)`

## global_state
Status: ACTIVE
Evidence:
- wqt-backend/app/db.py:292 `session.query(GlobalState).filter(GlobalState.id == 1)`
- wqt-backend/app/main.py:1114 `@app.get("/api/warehouse-map")`
- scripts/api.js:439 `fetchJSON('/api/warehouse-map', { method: 'GET' })`

## order_events
Status: POSSIBLY_ACTIVE
Evidence:
- wqt-backend/app/db.py:219 `__tablename__ = "order_events"`
Notes:
- No read/write usage found outside model definition; usage only mentioned in comments.

## orders
Status: ACTIVE
Evidence:
- wqt-backend/app/db.py:1188 `rec = OrderRecord(...)`
- wqt-backend/app/main.py:1022 `@app.post("/api/orders/record")`
- scripts/api.js:514 `fetchJSON('/api/orders/record', { method: 'POST', ... })`

## perf_samples
Status: UNKNOWN
Evidence:
- docs/schema_inventory.md:133 `## Table: perf_samples`
Notes:
- No references found in `wqt-backend` or `scripts` via search.

## shift_sessions
Status: ACTIVE
Evidence:
- wqt-backend/app/db.py:845 `def start_shift(...):`
- wqt-backend/app/main.py:643 `@app.post("/api/shifts/start")`
- scripts/api.js:655 `fetchJSON(`/api/shifts/start${qs}`, { method: 'POST', ... })`

## usage_events
Status: ACTIVE
Evidence:
- wqt-backend/app/db.py:388 `session.add(UsageEvent(category=category, ...))`
- wqt-backend/app/main.py:569 `@app.get("/api/usage/recent")`

## users
Status: ACTIVE
Evidence:
- wqt-backend/app/db.py:239 `__tablename__ = "users"`
- wqt-backend/app/main.py:816 `@app.post("/api/auth/register")`
- wqt-backend/app/main.py:199 `@app.get("/api/me")`

## warehouse_locations
Status: ACTIVE
Evidence:
- wqt-backend/app/db.py:501 `def bulk_upsert_locations(...):`
- wqt-backend/app/main.py:1141 `@app.post("/api/warehouse-locations/bulk")`
- scripts/api.js:451 `fetchJSON('/api/warehouse-locations/bulk', { method: 'POST', ... })`
