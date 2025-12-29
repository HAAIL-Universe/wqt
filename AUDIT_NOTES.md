## 2025-12-29 21:45 - Start Order atomic swap + tour reposition (instrumented)
- Branch/SHA: test/bay-occupancy-integer-check / 8ad5565cfd8dad0484199ac26bfe63efd843ed77
- Repro steps (local, debug=tour):
  1) Start local static server at repo root (python -m http.server 8088).
  2) Pre-set `WQT_CURRENT_USER` in localStorage.
  3) Open `http://127.0.0.1:8088/index.html?tour=1&debug=tour`, go Tracker, enter customer/units/loc, click Start.
- Console first error: Pending local run (expect CORS errors only on local origin).
- Network (scripts): N/A (local run pending).
- Network (failed request): N/A (local run pending).
- Evidence (instrumentation logs):
  - `[tour][swap] pre-swap` ... (pending capture)
  - `[tour][swap] post-swap` ... (pending capture)
  - `[tour][swap] post-layout` ... (pending capture)
  - `[tour] wrap-open target` ... (pending capture)
  - `[tour] wrap-open overlay` ... (pending capture)
- Classification (A/B/C/D/E/F): E) Layout shift / render race causing incorrect hitboxes and tour overlay misposition.
- Root cause (file:line): `scripts/core-tracker-history.js:432` swapped `orderHeaderForm`/`orderHeaderProgress` via non-atomic state (previously `fadeSwap`), allowing an intermediate stacked frame.
- Fix summary:
  - `scripts/core-tracker-history.js` toggles `#activeOrderCard.order-active` and swaps header visibility synchronously; adds `ui-swap` to suppress transitions during the flip; defers tour reposition after 2x rAF + 50ms.
  - `scripts/tour.js` adds debug flag parsing for `?debug=tour`/`__WQT_DEBUG_TOUR`, logs wrap-open target + overlay rects, and exposes `positionAll` for post-layout reposition.
  - `styles/index.css` adds `order-active` and `ui-swap` visibility/transition guards.
- Verification (local): pending (no local harness in this environment); run with `?debug=tour` to confirm stable rects and clickable Log Wrap.
- Verification (Render): Julius to validate using same steps; confirm Log Wrap clickable and highlight aligned.

## 2025-12-29 19:10 - Tour respects skip/completed unless forced
- Branch/SHA: test/bay-occupancy-integer-check / f42aa297bb4759abea373ff7d2a19535580df4cb
- Repro steps (Render, pre-fix):
  1) Pre-seed localStorage with `WQT_CURRENT_USER` and `wqt_tour_v1__u_test-user` = `{status:"skipped", stepIndex:3}`.
  2) Open `https://wqt-kd85.onrender.com/index.html?tour=1`.
  3) Observe `tour` params remain, boot/tour scripts load, and `/api/*` returns 401 without auth.
- Console first error: Failed to load resource: the server responded with a status of 401 ().
- Network (scripts): `https://wqt-kd85.onrender.com/scripts/boot.js` 200; `https://wqt-kd85.onrender.com/scripts/tour.js` 200.
- Network (failed request): `https://wqt-backend.onrender.com/api/me` 401; `https://wqt-backend.onrender.com/api/shifts/active?...` 401.
- Classification (A/B/C/D/E/F): C) Init runs but gating is wrong (tour=1 overrides skipped/completed).
- Root cause (file:line): `scripts/tour.js:662-669` bootstraps on `tour=1` without honoring `state.status === skipped/completed`.
- Fix summary: add `tour=force` override and only force-start when forced; set a boot flag when reset runs so the tour can honor `tour=reset` even after URL cleanup.
- Verification (local, post-fix):
  - `?tour=1` + skipped state preserves `status:"skipped"`.
  - `?tour=force&tour=1` promotes to `status:"active"`.
  - `?tour=reset&tour=1` resets and starts (`status:"active"`).
- Verification (Render, post-fix attempt):
  - Opened `https://wqt-kd85.onrender.com/index.html?tour=reset&tour=1` with localStorage pre-seeded to completed.
  - URL settled to `?tour=1`, but stored `wqt_tour_*` remained `status:"completed"` (reset did not clear).
  - /api responses returned 401 without auth; console first error: "Failed to load resource: the server responded with a status of 401 ()".
  - Render appears to be running pre-fix assets; requires deploy to validate.

## 2025-12-29 19:32 - Re-run onboarding button is unbound
- Branch/SHA: test/bay-occupancy-integer-check / 20f4a7b62f47e5a0ff6c0e82fc4fa94a253b7ee9
- Repro steps (local):
  1) Start local static server at repo root (python -m http.server 8083).
  2) Pre-set `WQT_CURRENT_USER` in localStorage.
  3) Open `http://127.0.0.1:8083/index.html` and click "Re-run onboarding".
- Console first error: Access to fetch at 'https://wqt-backend.onrender.com/api/shifts/active?device-id=...' from origin 'http://127.0.0.1:8083' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
- Network (scripts): N/A (static server; not captured in this run).
- Network (failed request): `https://wqt-backend.onrender.com/api/shifts/active?...` blocked by CORS (local origin).
- Classification (A/B/C/D/E/F): C) Init not called / handlers not bound.
- Root cause (file:line): `index.html:693` calls `restartOnboarding()` but no function is defined anywhere in scripts.
- Fix summary:
  - `scripts/boot.js` defines `restartOnboarding()` and routes to `showTab('tracker')`, `Tour.reset()`, `Tour.forceStart()`.
  - `scripts/tour.js` exposes `window.Tour` with `reset()` + `forceStart()` so the button can override skipped/completed.
- Verification (local):
  - Click "Re-run onboarding" creates `wqt_tour_*` with `status:"active"` and shows Tracker tab.
- Verification (Render): pending deploy; Render boot.js does not yet include `restartOnboarding`.

## 2025-12-29 19:52 - Render serving stale boot/tour scripts
- Branch/SHA: test/bay-occupancy-integer-check / 8c4cd051a31a73a233ab88aef9283ae8aee0c3b1
- Repro steps (Render, pre-fix):
  1) Pre-set `WQT_CURRENT_USER` in localStorage to avoid redirect.
  2) Open `https://wqt-kd85.onrender.com/index.html`.
  3) Click "Re-run onboarding".
- Console first error: Failed to load resource: the server responded with a status of 401 ().
- Network (scripts): `/scripts/boot.js` 200; `/scripts/tour.js` 200.
- Network (failed request): `/api/shifts/active` 401; `/api/me` 401.
- Classification (A/B/C/D/E/F): A) Script caching (stale assets).
- Root cause (file:line): `index.html` loads `scripts/boot.js` and `scripts/tour.js` without cache-busting; Render/CDN continues serving pre-fix assets.

## 2025-12-29 20:05 - Tour waits on 0x0 customer-select target
- Branch/SHA: test/bay-occupancy-integer-check / bae624c5b6c47f4e5ee6aa2364c9644f70cd2182
- Repro steps (Render):
  1) Pre-set `WQT_CURRENT_USER` in localStorage.
  2) Open `https://wqt-kd85.onrender.com/`.
  3) Click "Re-run onboarding".
- Console first error: Failed to load resource: the server responded with a status of 401 ().
- Network (scripts): `https://wqt-kd85.onrender.com/scripts/tour.js?v=8c4cd05` 200.
- Network (failed request): `/api/shifts/active` 401; `/api/me` 401; `/api/state` 401.
- Classification (A/B/C/D/E/F): C) Init runs but target never becomes visible.
- Root cause (file:line): `scripts/tour.js:347` treats any element with rect>0 as visible; `customer-select` exists but rect is 0x0, so overlay never renders.
- Evidence: target rect `width=0,height=0`; tour state `status:"active", stepIndex:1`, overlay not present.

## 2025-12-29 20:16 - Tour autostarts too early + units input auto-advance
- Branch/SHA: test/bay-occupancy-integer-check / 505fdbc66040ab2b8da3f5a7b1aeeacb5f9fe141
- Repro steps (local):
  1) Start local static server at repo root (python -m http.server 8085).
  2) Pre-set `WQT_CURRENT_USER` in localStorage.
  3) Dispatch `tour:shift-length-selected` without starting a shift.
  4) Set UI state to shift_active, activate units step, type a single digit in Units input.
- Console first error: Access to fetch at 'https://wqt-backend.onrender.com/api/shifts/active?...' from origin 'http://127.0.0.1:8085' has been blocked by CORS policy (expected local origin).
- Network (scripts): N/A (local static server; no capture).
- Network (failed request): `https://wqt-backend.onrender.com/api/shifts/active?...` blocked by CORS.
- Classification (A/B/C/D/E/F): C) Init/handlers bind to the wrong triggers (tour starts before shift is active; input auto-advances).
- Root cause (file:line):
  - `scripts/tour.js:671` listens for `tour:shift-length-selected` and starts the tour even before shift start.
  - `scripts/tour.js:20` units/locations steps use `advanceOn.inputValid`, causing auto-advance on first digit.
- Evidence:
  - After `tour:shift-length-selected`, tour state becomes `status:"active", stepIndex:0` without shift started.
  - On units step with shift_active, input event advances from stepIndex 2 -> 3 immediately.
- Fix summary:
  - Autostart moved to `tour:shift-started`, and only if status is not completed/skipped.
  - Units/locations no longer auto-advance on input; Enter advances; locations step autofocuses input.
  - Mobile Next button gets larger, full-width styling on small screens.
- Verification (local):
  - `tour:shift-length-selected` does not start tour; `tour:shift-started` starts at customer-select.
  - Units input no longer auto-advances; Enter advances and focuses `#order-locations`.
  - Mobile viewport shows larger Next button (padding 10px 12px, font size 14px).
- Verification (Render, no login):
  - `scripts/boot.js?v=221275b` 200, `scripts/tour.js?v=221275b` 200; /api 401 pre-login.
  - `tour.js` contains `tour:shift-started` listener and `applyActionLayout` mobile styles.
  - Re-run onboarding shows tour overlay on Tracker (visible).

## 2025-12-29 18:40 - Tour reset URL rewrite + no auto-start
- Branch/SHA: test/bay-occupancy-integer-check / f42aa297bb4759abea373ff7d2a19535580df4cb
- Repro steps:
  1) Start local static server at repo root (python -m http.server 8081).
  2) Open `http://127.0.0.1:8081/index.html?tour=reset&tour=1` with `WQT_CURRENT_USER` pre-set in localStorage.
  3) Observe URL rewrites to `?tour=1`, tour overlay does not show, and no `wqt_tour_*` keys are created.
- Console first error: Access to fetch at 'https://wqt-backend.onrender.com/api/shifts/active?device-id=...' from origin 'http://127.0.0.1:8081' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
- Network (scripts): `/scripts/boot.js` 200; `/scripts/tour.js` 200.
- Network (failed request): `https://wqt-backend.onrender.com/api/shifts/active?...` blocked by CORS (local origin).
- Classification (A/B/C/D/E/F): C) Init not called / handlers not bound.
- Root cause (file:line):
  - `scripts/boot.js:13-36` resets `tour=reset` via `window.location.replace`, triggering an immediate reload to `?tour=1` before tour startup can run.
  - `scripts/tour.js:626-631` starts only on `tour:shift-length-selected`, so `tour=1` alone never boots when onboarding is already complete.
- Fix summary:
  - `scripts/boot.js` switches URL cleanup to `history.replaceState` (no reload).
  - `scripts/tour.js` bootstraps `tour=1` and selects start step from current UI inputs.
- Verification (local, headless Playwright):
  - Opened `http://127.0.0.1:8081/index.html?tour=reset&tour=1` with `WQT_CURRENT_USER` pre-set.
  - URL settled at `?tour=1` and new `wqt_tour_*` key created (state active, stepIndex=1).
  - Console: CORS error for Render backend (expected for local origin); no page errors.
- Risks: `tour=1` now force-starts even if a user previously skipped/completed, but only when explicitly set in the URL.

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

## 2025-12-29 14:05 - Bay occupancy warehouse id normalization (Map—Warehouse3)
- Branch/SHA: test/bay-occupancy-integer-check / 27f2507a02fe433836123a7964087cfdcb63d4d9
- Repro steps (per user report):
  1) Open Warehouse Map (Warehouse 3).
  2) Observe aisles B, D, J, F, H show available in DB, but UI highlights only B, F, H.
  3) Open aisle D or J; UI reports no available space in the info list.
- Console first error: None reported (user-provided evidence bundle).
- Network (failed request): None; `/api/bay-occupancy` + `/api/warehouse-map` return 200 (user-provided evidence bundle).
- Data evidence (user-provided):
  - bay_occupancy.json warehouses use EM DASH (U+2014), e.g., "Map—Warehouse3".
  - Neon COUNT(*) WHERE warehouse = 'Map-Warehouse3' returned 0 (dash mismatch).
- Classification (A/B/C/D/E/F): F) Backend data mismatch not surfaced in UI (closest fit for required classification).
- Root cause (file:line):
  - `index.html:736` uses an EM DASH in the Warehouse Map heading, feeding `scripts/core-state-ui.js` warehouse extraction without normalization.
  - `wqt-backend/app/db.py:849` filtered bay_occupancy rows by raw warehouse string, allowing Unicode dash variants to diverge.
- Fix summary:
  - Normalize warehouse identifiers on UI + backend, and validate bay_occupancy writes against active warehouse_locations to prevent ghost rows.
- Verification: pending (requires Neon SQL checks + live UI capture per runbook).
- Risks: If Neon migration is not applied, mixed dash rows can still exist until normalized in DB.

## 2025-12-29 15:10 - Bay occupancy semantics + sanity query
- Branch/SHA: test/bay-occupancy-integer-check / 27f2507a02fe433836123a7964087cfdcb63d4d9
- Evidence (code-level):
  - Occupancy math uses used units: `scripts/core-state-ui.js:2651` (`computeBayRemaining` = 6 - (euro*2 + uk*3)).
  - UI availability filter: `scripts/core-state-ui.js:2657` (`remaining >= 1.0`).
  - Table definition names "pallet occupancy" with capacity constraint: `wqt-backend/migrations/20251228_add_bay_occupancy.sql:1-16`.
  - New row default on write: `wqt-backend/app/db.py:955` seeds `euro_count=0`, `uk_count=2` (full).
- Sanity query (Neon): compute remaining and available euro units for humans.
  ```sql
  SELECT
    warehouse, row_id, aisle, bay, layer,
    euro_count, uk_count,
    (6 - (euro_count * 2 + uk_count * 3)) AS remaining_units,
    round((6 - (euro_count * 2 + uk_count * 3)) / 2.0, 2) AS available_euro_units
  FROM public.bay_occupancy
  WHERE warehouse = '<WAREHOUSE_ID>'
  ORDER BY aisle, bay, layer;
  ```
- Optional API sanity check (browser console after `/api/bay-occupancy`):
  ```js
  rows.map(r => ({
    ...r,
    remaining_units: 6 - (r.euro_count * 2 + r.uk_count * 3),
    available_euro_units: Math.round(((6 - (r.euro_count * 2 + r.uk_count * 3)) / 2) * 10) / 10
  }))
  ```
- Follow-up note: If `uk_count=2` should represent empty, current math would be inconsistent. If not intentional, minimal fix is to seed missing rows with `euro_count=0`, `uk_count=0` in `wqt-backend/app/db.py:955` (or avoid auto-creating rows until first write).

## 2025-12-29 15:45 - Seed missing bay_occupancy rows as empty
- Branch/SHA: test/bay-occupancy-integer-check / 27f2507a02fe433836123a7964087cfdcb63d4d9
- Repro steps (per user report):
  1) Open Warehouse Map.
  2) Click +UK on a bay with no prior occupancy row.
  3) Observe action behaves like bay is full (capacity_exceeded / no availability).
- Console first error: None reported (user-provided evidence bundle).
- Network (failed request): N/A (requires live capture).
- Classification (A/B/C/D/E/F): F) Backend data mismatch not surfaced in UI.
- Root cause (file:line): `wqt-backend/app/db.py:955` seeds missing rows as full (`uk_count=2`), so first-touch actions start at capacity.
- Fix summary: Seed missing bay_occupancy rows as empty (`euro_count=0`, `uk_count=0`) before applying deltas.
- Verification: pending; requires Neon sanity query + UI click evidence to confirm row initializes at 0/0 then increments.
- Risks: None known; behavior aligns with occupied-pallet semantics.
- Note: Prior warehouse-id normalization/debug changes were parked; not part of this fix.
- Note: Superseded by 16:10 baseline-derived approach below.

## 2025-12-29 16:10 - Baseline-full derived, not persisted
- Branch/SHA: test/bay-occupancy-integer-check / 27f2507a02fe433836123a7964087cfdcb63d4d9
- Evidence (code-level):
  - Derived baseline-full in UI layout uses `uk_count=2` for unknown bays: `scripts/core-state-ui.js:2774`.
  - bay_occupancy rows represent observed state overrides (only written via apply).
- Classification (A/B/C/D/E/F): F) Backend data mismatch not surfaced in UI.
- Fix summary:
  - Missing bay_occupancy rows are not persisted as full; apply logic now uses a baseline-full assumption for missing rows when computing deltas, but only writes the resulting counts (observed state).
- Verification: pending; requires UI + Neon sanity query.

## 2025-12-29 16:35 - Runtime verification (user)
- Branch/SHA: test/bay-occupancy-integer-check / e7962fb975fbb37c70cee45e59428eb179fc3ac2
- Repro steps:
  1) Baseline unknown bay treated as full (UK=2).
  2) UI blocks -EURO at euro_count=0.
  3) -UK frees capacity; +EURO becomes allowed; -EURO allowed once euro_count > 0.
- Console first error: None reported (user runtime verification).
- Network (scripts): N/A (user runtime verification).
- Network (failed request): N/A (user runtime verification).
- Classification (A/B/C/D/E/F): N/A (verification).
- Fix summary: No further logic changes; confirms counts represent OCCUPIED pallets and UI gating matches capacity rules.
- Verification: User reports flow is correct and working.
- Risks: None reported.

## 2025-12-29 14:56 - global_state usage audit
- Branch/SHA: test/bay-occupancy-integer-check / 06ee2f496f11b01eaeec09c62fa2daefa829b111
- Repro steps: N/A (DB usage audit; no runtime change).
- Console first error: None (not captured).
- Network (scripts): None (not captured).
- Network (failed request): None (not captured).
- Evidence (code-level):
  - `wqt-backend/app/main.py:1133` GET /api/warehouse-map reads global_state via load_global_state.
  - `wqt-backend/app/main.py:1159` POST /api/warehouse-map writes global_state via save_global_state.
  - `wqt-backend/app/db.py:101` GlobalState ORM model bound to public.global_state.
  - `scripts/api.js:438` fetches /api/warehouse-map; `scripts/api.js:443` posts /api/warehouse-map.
  - `scripts/core-state-ui.js:3987` calls saveWarehouseMapToBackend (shared map commit).
- Evidence (DB-level via psycopg2 on DATABASE_URL):
  - public.global_state exists; rowcount = 1.
  - No views/matviews/functions/triggers referencing global_state.
  - No FKs referencing global_state.
  - No pg_cron/pgagent scheduled jobs installed; no jobs referencing global_state.
- Classification (A/B/C/D/E/F): N/A (non-incident audit).
- Fix summary: None; removal blocked because /api/warehouse-map still depends on global_state.
- Verification: ripgrep usage scan + Neon read-only queries listed above.
- Risks: Dropping/renaming public.global_state would break warehouse map fetch/save and shared map commit.

## 2025-12-29 15:05 - Warehouse map state decouple (dual-write)
- Branch/SHA: test/bay-occupancy-integer-check / 333218938a7f5aebfe9632b1ca8c897d632263a9
- Repro steps: Not run (pending verification in UI).
- Console first error: None (not captured).
- Network (scripts): None (not captured).
- Network (failed request): None (not captured).
- Evidence (code-level):
  - `wqt-backend/migrations/20251229_add_warehouse_map_state.sql` adds warehouse_map_state table.
  - `wqt-backend/app/db.py` adds WarehouseMapState model + load/save helpers.
  - `wqt-backend/app/main.py:1133` GET /api/warehouse-map reads warehouse_map_state first, then falls back to global_state.
  - `wqt-backend/app/main.py:1159` POST /api/warehouse-map dual-writes to warehouse_map_state + global_state.
  - `scripts/api.js:443` POST /api/warehouse-map now includes ?warehouse= from UI context.
- Classification (A/B/C/D/E/F): F (backend dependency cleanup; no runtime failure observed).
- Root cause (file:line): /api/warehouse-map persisted shared map in global_state (legacy).
- Fix summary: Introduce warehouse_map_state; GET reads new table first; POST dual-writes to new table + global_state (temporary).
- Verification: pending (UI save + Neon SELECT count(*) WHERE warehouse='Map-Warehouse3').
- Risks: If migration not applied in Neon, writes to warehouse_map_state can fail; global_state fallback remains for compatibility.

## 2025-12-29 15:49 - Remove warehouse map layout persistence (product decision)
- Branch/SHA: test/bay-occupancy-integer-check / e7d56369f744af29c94a6cb27d3060f26fab30f9
- Repro steps (user-reported): Warehouse Tools → Open Warehouse Map → map loads layout + availability correctly.
- Console first error: none (user-reported).
- Network (scripts): not captured.
- Network (failed request): none (user-reported; no POST /api/warehouse-map in normal flow).
- Classification (A/B/C/D/E/F): F (backend feature removal; no runtime failure observed).
- Root cause (file:line): Warehouse map layout persistence is obsolete; shared layout saves should be removed.
- Fix summary: Remove Save Map control + POST /api/warehouse-map; GET now returns canonical layout only; remove warehouse_map_state model/migration.
- Verification checklist: open Warehouse Map and confirm layout + occupancy render; DevTools shows GETs only and no POST /api/warehouse-map; console shows no errors.
- Risks: If any hidden workflow still expects Save Map, it will no longer persist layout.

## 2025-12-29 15:57 - Global state cleanup (prep for rename)
- Branch/SHA: test/bay-occupancy-integer-check / e907a0ad857ce33a8182252d0f250c7771980b71
- Repro steps: Pending (post-rename verification: open Warehouse Map and confirm layout loads).
- Console first error: Pending (post-rename).
- Network (scripts): Pending (post-rename).
- Network (failed request): Pending (post-rename; ensure no POST /api/warehouse-map).
- Evidence (code-level):
  - `wqt-backend/app/db.py` no longer used for global_state at runtime; rg shows only docs/AUDIT references.
  - No runtime imports/usages of load_global_state/save_global_state remain outside `wqt-backend/app/db.py` prior to removal.
- Classification (A/B/C/D/E/F): F (backend cleanup; no runtime failure observed).
- Fix summary: Remove GlobalState model + helpers from runtime code; global_state table now unused by app.
- Verification checklist (post-rename): open Warehouse Map, confirm GET /api/warehouse-map 200 and no POST; console shows no errors.
- Risks: If any hidden runtime path still expects global_state, rename would fail; rg suggests none.
