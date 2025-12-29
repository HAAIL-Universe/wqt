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
