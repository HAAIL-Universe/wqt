## 2025-12-29 11:40 - Warehouse Map loading gate
- Branch/SHA: test/bay-occupancy-integer-check / 4ae48f32e080655254fb8a550d14e330d1ab7ea0
- Repro steps:
  1) Login to WQT (operative; role does not matter).
  2) On the operative tools page ("Warehouse tools"), click "Open Warehouse Map".
  3) Warehouse Map - Warehouse 3 opens.
  4) Observed: UI renders in visible stages (chips appear, then green "has space" highlights appear later), causing uncertainty during the first several seconds.
- Console first error: No console errors (hard reload Ctrl+Shift+R on Warehouse Map - Warehouse 3 with DevTools open).
- Network (Warehouse Map init):
  - state?device-id=... 200 ~4.24s (slowest)
  - summary?warehouse=... 200 1.10s
  - warehouse-map 200 1.48s
  - by-aisle?warehouse=... (many) 200 ~0.97s–1.84s
  - bay-occupancy?warehouse=... 200 1.15s (also another 972ms)
  - check?device-id=... 200 929ms
  - DevTools footer: Finish 46.42s
- Classification (A/B/C/D/E/F): E) Gating/readiness not enforced (partial render before derived availability ready).
- Root cause (file:line):
  - `scripts/core-state-ui.js:3796` renders aisle chips before global occupancy + outbox-derived availability is computed.
  - `scripts/core-state-ui.js:3798-3799` loads occupancy asynchronously and only later updates `wmAisleHasSpace` via `renderCurrentOccupancyList`, causing a visible neutral state first.

## 2025-12-29 12:16 - Warehouse Map canonical layout source
- Branch/SHA: test/bay-occupancy-integer-check / 972abf34b68627f7813a0c0dc0f56d5fd44fb752
- Repro steps: N/A (DB audit + backend refactor).
- Console first error: N/A.
- Network (failed request): N/A.
- Classification (A/B/C/D/E/F): N/A (refactor).
- Data evidence: public.global_state rowcount = 1; schema columns id (integer), payload (text).
- Code usage evidence:
  - `wqt-backend/app/main.py:1136` GET /api/warehouse-map reads global_state.
  - `wqt-backend/app/main.py:1149` POST /api/warehouse-map writes global_state.
  - `wqt-backend/app/db.py:102` GlobalState model.
- Verification: GET /api/warehouse-map served from canonical tables (validated by code inspection in `wqt-backend/app/main.py:1136` calling `get_warehouse_map_from_locations` before fallback; no runtime test run).

## 2025-12-29 12:22 - Warehouse Map warehouse scoping + legacy merge
- Branch/SHA: test/bay-occupancy-integer-check / 972abf34b68627f7813a0c0dc0f56d5fd44fb752
- Repro steps: N/A (backend refactor).
- Data evidence: public.global_state rowcount = 1; schema columns id (integer), payload (text).
- Change summary: GET /api/warehouse-map accepts `?warehouse=` and defaults to `WH3` if missing; canonical aisles are merged with legacy map keys, with canonical aisles winning.
- Verification (runtime): pending; requires live `/api/warehouse-map` response capture and frontend render confirmation.

## 2025-12-29 12:56 - Warehouse Map loader spinner hardening
- Branch/SHA: test/bay-occupancy-integer-check / fe0126bb97ddb75942760ebfdcb8fe855d01bcf9
- Repro steps:
  1) Login to WQT (role does not matter).
  2) On "Warehouse tools", click "Open Warehouse Map".
  3) Warehouse Map - Warehouse 3 opens.
  4) Blocking loader appears; reported spinner not visibly animating.
- Console first error: No console errors (per user report).
- Classification (A/B/C/D/E/F): F (UX affordance issue per request).
- Root cause (file:line): `index.html:797` loader relied on CSS spinner; user reported no visible animation in loading state.
- Fix summary: replaced CSS-only spinner with inline SVG animateTransform inside `#wmLoading` to guarantee animation.
- Verification (RUNTIME VERIFIED, user-captured evidence):
  - Environment: Chrome DevTools, Network throttling Slow 3G, Disable cache enabled, hard refresh during Warehouse Map load.
  - Loader: “Loading warehouse information…” visible while requests in-flight; loader disappears once map becomes interactive.
  - DOM: `#wmLoading` contains inline SVG spinner with `<animateTransform attributeName="transform" type="rotate" ... repeatCount="indefinite">`.
  - Console: no errors observed during capture.
  - Network: 200 responses observed for `warehouse-map?warehouse=Map-Warehouse3` and `bay-occupancy?warehouse=Map-Warehouse3`.
  - Evidence: user-provided screenshots captured during live run (slow3g + disable cache).
