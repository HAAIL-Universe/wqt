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
