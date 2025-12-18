# iOS PWA Logout Fix - Quick Reference Card

**Problem:** iOS PWA shows blank screen after logout → login  
**Fix Status:** ✅ DEPLOYED (Commit: `4fc202c`)  
**Risk Level:** 🟢 Low  
**Testing:** See `TESTING_GUIDE.md`

---

## What Changed (5 Fixes)

### 1️⃣ Auth Gate Deferred
**File:** `index.html` line 1121  
**Change:** `gateWqtByLogin()` now runs in `DOMContentLoaded` instead of immediately  
**Why:** Prevents race with logout cleanup on iOS

### 2️⃣ Logout Redirect Delayed
**File:** `boot.js` line 87  
**Change:** `window.location.href` wrapped in `requestAnimationFrame()`  
**Why:** Ensures DOM teardown completes before redirect

### 3️⃣ iOS bfcache Handler Added
**File:** `boot.js` line 184  
**Change:** New `pageshow` event listener re-validates auth on cache restore  
**Why:** iOS restores pages from cache without re-checking auth

### 4️⃣ Pending Ops Cleared on Logout
**File:** `boot.js` line 82  
**Change:** `Storage.savePendingOps([])` called during logout  
**Why:** Prevents offline ops from old user replaying under new user

### 5️⃣ User Switch Guard Enhanced
**File:** `storage.js` line 54  
**Change:** Old user's namespaced keys deleted when new user logs in  
**Why:** Prevents data bleed on shared devices

---

## Quick Validation (30 seconds)

1. Open iOS Safari → WQT app
2. Log in → Add pick → Log out → Log in
3. ✅ **Should see:** No blank screen, data persists
4. ❌ **Fail if:** Blank screen or data lost

---

## Console Success Indicators

### Logout:
```
[logout] Full reset complete - redirecting to login
[logout] Cleared pending ops queue
```

### iOS bfcache:
```
[iOS bfcache] Auth valid after restore, continuing...
```

### User Switch:
```
[Storage] User switch detected: USER1 → USER2
[Storage] Cleared old user namespaced keys for USER1
```

---

## Rollback (Emergency Only)

```bash
git revert 4fc202c
git push origin copilot/audit-changes-between-branches
```

⚠️ **Warning:** Rollback restores broken behavior - use only if new critical bug found

---

## Files to Review

| File | Purpose | Lines |
|------|---------|-------|
| `REGRESSION_AUDIT_REPORT.md` | Full technical analysis | All |
| `FIX_SUMMARY.md` | Executive summary | All |
| `TESTING_GUIDE.md` | Step-by-step test cases | All |

---

## FAQ

**Q: Does this affect desktop browsers?**  
A: No, fixes are defensive and work on all browsers.

**Q: What about Android PWA?**  
A: Also benefits (Android also uses bfcache).

**Q: Performance impact?**  
A: Negligible (<16ms delay on logout redirect).

**Q: Breaking changes?**  
A: None - purely defensive fixes.

**Q: Need to clear user data?**  
A: No - backward compatible with existing localStorage.

---

## Support Contacts

**Technical Issues:** Check `REGRESSION_AUDIT_REPORT.md` Section 3  
**Test Failures:** Check `TESTING_GUIDE.md` Troubleshooting  
**Production Issues:** Rollback + file GitHub issue

---

**Last Updated:** 2025-12-18  
**Version:** 1.0  
**Commit:** `4fc202c`

---

## Decision Tree

```
Is iOS PWA blank after logout?
├─ YES → Check console for "[logout] Full reset complete"
│   ├─ Present → Fix deployed correctly, may be different issue
│   └─ Missing → Fix not deployed, check commit hash
└─ NO → ✅ Working as expected
```

---

**Print this card for quick reference during testing** 📋
