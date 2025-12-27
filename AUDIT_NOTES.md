# WQT API/Contract Audit Notes

## Evidence: 404s and Route Availability

### 1. 404 Response for `/` and `HEAD /`
- Request: `GET /` to https://wqt-backend.onrender.com
- Response: 404, body: {"detail":"Not Found"}
- Request: `HEAD /` to https://wqt-backend.onrender.com
- Response: 404, body: {"detail":"Not Found"}

### 2. OpenAPI Docs Availability
- Request: `GET /docs` to https://wqt-backend.onrender.com/docs
- Request: `GET /openapi.json` to https://wqt-backend.onrender.com/openapi.json
- [Status codes/results to be filled after manual check]

### 3. Frontend Failing Endpoints (from Network tab)
- [Paste first 10 failing requests: path, method, status]
- Example:
  - GET /api/state 404
  - GET /api/history/me 404
  - GET /api/shift/active 404
  - ...

### 4. Backend Route Inventory (from startup log)
- [To be filled after adding route logging and redeploying with AUDIT_ROUTES=1]

### 5. Conclusion
- [To be filled after route audit: Case 1, 2, or 3]

---
(append-only: do not delete previous entries)

# WQT Frontend Boot/Interactivity Audit

## Evidence
### Console Error (on load)
- [Paste stack trace here after manual test]

### Network Tab (JS files)
- [Paste URLs, status codes, response sizes for main JS]

### getEventListeners($0) on dead button
- [Paste result: empty or not]

### elementFromPoint overlay check
- [Paste result: selector if overlay, else null]

## Classification
- [A/B/C/D/E: Pick one, justify]

## Root Cause
- [File/line, why JS did not run or event binding failed]

---
(append-only: do not delete previous entries)

# WQT Frontend Boot/Interactivity Audit

## Audit Header
- Timestamp: 2025-02-14T00:00:00Z
- Branch: reapply-updates
- HEAD: 26d0b7fbbddbdd4170ecb380a0fc776621d3c3bb
- git status: ?? AUDIT_NOTES.md; ?? AUDIT_NOTES_WQT.md
- Timestamp (actual): 2025-12-27T13:58:03.0289085+00:00

## Evidence (2025-02-14)
- Timestamp: 2025-12-27T14:01:53.0388862+00:00
- DevTools: not run in this environment (no browser session available). Static analysis used instead.
- Entry scripts: index.html loads scripts/storage.js, scripts/api.js, scripts/core-state-ui.js, scripts/customer-selector-modal.js, scripts/core-metrics-actions.js, scripts/core-tracker-history.js, scripts/boot.js (per index.html).
- Static error candidate: duplicate const declaration in scripts/core-state-ui.js lines 2 and 52 (Identifier 'SYNC_STATUS_MAP' already declared) -> parse-time crash, prevents handlers from binding.

## Classification
- B) Main JS loads but crashes during evaluation (syntax error on duplicate const in core-state-ui.js).

## Root Cause
- scripts/core-state-ui.js:2 and scripts/core-state-ui.js:52 both declare const SYNC_STATUS_MAP, which is a SyntaxError at parse time. This aborts evaluation of core-state-ui.js, leaving boot-time functions undefined and UI handlers unbound.

## Fix Summary
- Removed the duplicate SYNC_STATUS_MAP block so core-state-ui.js parses.
- Added boot harness in scripts/boot.js: boot step markers, error banner, and ?debug=1 banner.

## Test Results
- Not run here (no local browser run). Manual verification required: reload, check console, click tabs/buttons/shift-length.
