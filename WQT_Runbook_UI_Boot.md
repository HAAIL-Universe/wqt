## UI Boot Authority
All frontend/UI state decisions must conform to this runbook.
If UI behavior conflicts, this document overrides ad-hoc logic.


# WQT UI Boot & Interactivity Runbook

Purpose: restore interactivity when the UI renders but clicks/buttons/tabs do nothing.
This runbook is used alongside WQT_Codex_Contract.md.

## 1) Fast triage checklist (2 minutes)
In DevTools:
- Console: is there any **uncaught** error on load?
- Network: are JS files 200 or 404?
- Elements: is there an overlay covering the page?
- Sources: did init/bind code run?

If you find the first uncaught console error, treat it as the primary root cause until proven otherwise.

## 2) Failure classes and how to prove them

### A) Script not loading (404/path/caching/service worker)
Evidence:
- Network shows JS 404 (or blocked)
- Console may show “Failed to load resource”
Fix patterns:
- Correct script `src` path in HTML
- Add `defer` if DOM binding runs too early
- If caching suspected and no bundler hashing: temporary `?v=<sha>` querystring
Verification:
- Network: JS now 200 (correct size)
- Console: no load errors

### B) Script loads but crashes during evaluation (syntax/TDZ/duplicate const)
Evidence:
- Console shows SyntaxError / ReferenceError / TDZ before init
- UI dead because file never evaluates
Common causes:
- Duplicate `const` / duplicate function in same scope
- Referencing const before declared (TDZ)
- Default params referencing later consts
Fix patterns:
- Remove duplicate declarations
- Move const map/literal above first use
- Move default param usage into function body
Verification:
- Console: error gone
- Buttons respond

### C) Init never called / handlers not bound
Evidence:
- No crash, scripts load, but no events attach
- DOMContentLoaded hook missing / wrong
- Init gated behind condition that never becomes true
Fix patterns:
- Ensure single boot hook:
  `document.addEventListener("DOMContentLoaded", () => safeInit());`
- Remove early returns that prevent binding (backend failure must not brick UI)
Verification:
- Add temporary one-liner marker (or boot harness) to prove init ran
- Clicks now trigger expected behavior

### D) Overlay intercepting clicks
Evidence:
- Elements panel shows a full-screen overlay on top
- CSS has `position: fixed` + high z-index
- Pointer events capture clicks
Fix patterns:
- Hide/remove overlay at end of init and on init error
- If decorative: `pointer-events: none`
Verification:
- Clicking underlying buttons works

### E) Gating deadlock (health/auth waits forever)
Evidence:
- UI “loading” state never resolves
- Await on health/auth never returns; no fallback
Fix patterns:
- Add bounded timeout + fallback UI message
- Do not continuously poll
Verification:
- UI becomes interactive even if backend unreachable

### F) Backend error masked as “Failed to fetch” / “CORS blocked”
Evidence:
- DevTools Network shows 5xx/timeout OR net::ERR_FAILED
- Sometimes browser reports “CORS blocked” when upstream 500/502/504 response lacks CORS headers
Fix patterns:
- Confirm via curl with Origin header:
  - If CORS headers present on endpoint: not a CORS config problem
  - If missing only on errors: add minimal exception handler/middleware to attach CORS for allowed origins
- Make UI surface status + truncated error detail (without changing behavior)
Verification:
- Network: real status/body visible
- UI shows actionable failure detail

## 3) Required boot harness (small and safe)
When a boot crash can brick UX, implement:
- `window.__WQT_BOOT_STEP = "init_start" | "init_ok" | "init_failed"`
- On error: visible banner with message
- Optional `?debug=1` badge showing boot step + last error

Keep it minimal and do not alter normal UX unless failure occurs or debug=1.

## 4) Verification script (manual)
After patch:
- Hard refresh with “Disable cache”
- Confirm no fatal console errors
- Confirm:
  - Tabs switch views
  - Shift length buttons respond
  - Modals open/close
  - Key actions trigger expected network calls
- If backend is down:
  - UI still responds
  - Backend-dependent actions show explicit error (not silent dead UI)

## 5) Audit log template (paste into AUDIT_NOTES.md)
- Branch/SHA:
- Repro steps:
- Console first error:
- Network (scripts):
- Network (failed request):
- Classification (A/B/C/D/E/F):
- Root cause (file:line):
- Fix summary:
- Verification:
- Risks:

## 6) Extra Rule's 
- Any backend deploy that introduces new DB fields must have its migration applied in Neon before deploy.