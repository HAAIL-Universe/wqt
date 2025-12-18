# Manual Testing Guide - iOS PWA Logout/Redirect Fixes

**Test Environment Required:**
- iOS Safari (version 14+) OR
- iOS PWA (installed to home screen - RECOMMENDED)
- Multiple user accounts for testing

**Estimated time:** 30-45 minutes

---

## Pre-Test Setup

### 1. Install PWA (Recommended)
1. Open WQT app in iOS Safari
2. Tap Share button → "Add to Home Screen"
3. Name it "WQT Test"
4. Launch from home screen (not Safari tab)

### 2. Create Test Users
Create 3 test accounts:
- **User A**: `TESTA` / PIN: `1234`
- **User B**: `TESTB` / PIN: `5678`
- **Admin**: `ADMIN` / PIN: `9999` (supervisor role)

### 3. Clear Initial State
1. Open Safari → Settings → Advanced → Website Data
2. Find WQT domain, swipe left → Delete
3. Force-close Safari/PWA app
4. Relaunch

---

## Test Suite

### Test Case 1: Basic Logout → Login Cycle ✅

**Objective:** Verify no blank screen on logout/login  
**Priority:** CRITICAL

**Steps:**
1. Launch PWA as fresh install
2. Log in as User A
3. Navigate to "Tracker" tab
4. Start a shift (enter customer, units)
5. Add 2-3 picks
6. Go to "History" tab
7. Tap "Log Out" button
8. **OBSERVE:** Should redirect to login.html smoothly (no blank screen)
9. Log in as User A again (same credentials)
10. **VERIFY:** 
    - App loads fully (not blank)
    - Previous shift is restored (toast: "Shift restored")
    - Picks are visible in History tab

**Expected Result:** ✅ PASS
- No blank screen at any point
- State persists correctly
- Console shows: `[logout] Full reset complete - redirecting to login`

**Failure Signs:** 🔴 FAIL
- Blank white screen after logout
- Login successful but index.html is blank
- Console errors about `WQT_CURRENT_USER`

---

### Test Case 2: iOS Tab-Out During Logout ⚠️

**Objective:** Verify iOS bfcache doesn't break logout flow  
**Priority:** HIGH

**Steps:**
1. Log in as User A
2. Start a shift with some picks
3. Go to History tab
4. Tap "Log Out" button
5. **IMMEDIATELY** (within 1 second): Press Home button to minimize PWA
6. Wait 5 seconds (let iOS freeze the page)
7. Reopen PWA from home screen
8. **VERIFY:**
    - Either on login.html (clean state)
    - OR on index.html with re-auth modal
    - NOT stuck on blank page

**Expected Result:** ✅ PASS
- Console shows: `[iOS bfcache] Page restored from cache, re-validating auth...`
- Either redirects to login OR shows auth valid message
- No zombie/stuck state

**Failure Signs:** 🔴 FAIL
- Page is blank/unresponsive
- Navigation buttons don't work
- Console shows errors about undefined state

---

### Test Case 3: User Switch on Shared Device 🔒

**Objective:** Verify no data bleed between users  
**Priority:** HIGH (data security)

**Steps:**
1. Clear app data (see Pre-Test Setup #3)
2. Log in as User A
3. Create shift with 5 picks
4. Note the history: should show 1 day with 5 picks
5. Go to History → Log Out
6. **IMPORTANT:** Wait 2 seconds after redirect to login
7. Log in as User B (different user)
8. **VERIFY:**
    - History tab shows 0 days (empty)
    - No picks from User A visible
    - Console shows: `[Storage] Loaded data for user TESTB: 0 history records`
9. Create 3 picks as User B
10. Log out, log back in as User A
11. **VERIFY:**
    - User A still sees 5 picks (original data)
    - User B's 3 picks NOT visible

**Expected Result:** ✅ PASS
- Each user sees only their own data
- Console shows: `[Storage] User switch detected: TESTA → TESTB`
- Console shows: `[Storage] Cleared old user namespaced keys for TESTA`

**Failure Signs:** 🔴 FAIL
- User B sees User A's picks
- User A sees combined data (A + B picks)
- Console warnings about localStorage conflicts

---

### Test Case 4: iOS bfcache Restore (Tab Switch) 📱

**Objective:** Verify page restore from cache maintains auth  
**Priority:** MEDIUM

**Steps:**
1. Log in as User A
2. Browse app normally (no logout)
3. Press Home button
4. Open another app (e.g., Settings)
5. Wait 30 seconds (let iOS aggressively cache)
6. Return to PWA from app switcher
7. **VERIFY:**
    - App is responsive immediately
    - Auth is still valid (no redirect to login)
    - Console shows: `[iOS bfcache] Page restored from cache, re-validating auth...`
    - Console shows: `[iOS bfcache] Auth valid after restore, continuing...`

**Expected Result:** ✅ PASS
- No re-login required
- State preserved correctly
- No UI flickering/reloading

**Failure Signs:** 🔴 FAIL
- App reloads entirely (not using bfcache)
- Forced to login again (session lost)
- Blank screen on restore

---

### Test Case 5: Offline Logout Attempt 📶

**Objective:** Verify offline state doesn't corrupt logout  
**Priority:** MEDIUM

**Steps:**
1. Log in as User A (online)
2. Start shift, add picks
3. Enable Airplane Mode (Settings → Airplane Mode ON)
4. Attempt to add more picks (should work offline)
5. Go to History → Log Out
6. **OBSERVE:** Logout should complete (local-only)
7. Turn off Airplane Mode
8. **VERIFY:**
    - Redirected to login.html
    - Console shows: `[logout] Cleared pending ops queue`
9. Log in as User A
10. **VERIFY:**
    - No duplicate picks from offline session
    - Pending ops were cleared

**Expected Result:** ✅ PASS
- Offline logout succeeds
- Pending ops queue is empty after logout
- Re-login doesn't replay old operations

**Failure Signs:** 🔴 FAIL
- Logout fails/hangs in offline mode
- Pending ops persist after logout
- Next login replays old picks under wrong user

---

### Test Case 6: Rapid Logout/Login Cycle ⚡

**Objective:** Stress test auth gate race condition  
**Priority:** LOW (edge case)

**Steps:**
1. Log in as User A
2. Immediately log out (don't interact with app)
3. Immediately log in as User A
4. Repeat steps 2-3 five times quickly
5. **VERIFY:**
    - No blank screens at any point
    - No console errors about race conditions
    - State remains consistent

**Expected Result:** ✅ PASS
- All logout/login cycles complete cleanly
- No "Cannot read property of undefined" errors

**Failure Signs:** 🔴 FAIL
- Blank screen appears
- Console shows race condition errors
- localStorage appears corrupted

---

## Test Results Template

### Test Execution Log

| Test Case | Status | Notes | Timestamp |
|-----------|--------|-------|-----------|
| TC1: Basic Logout/Login | ⬜ Not Run | | |
| TC2: Tab-Out During Logout | ⬜ Not Run | | |
| TC3: User Switch | ⬜ Not Run | | |
| TC4: bfcache Restore | ⬜ Not Run | | |
| TC5: Offline Logout | ⬜ Not Run | | |
| TC6: Rapid Cycle | ⬜ Not Run | | |

**Legend:**
- ✅ PASS: Test passed, no issues
- 🔴 FAIL: Test failed, see notes
- ⚠️ PARTIAL: Some issues, not critical
- ⬜ Not Run: Test not executed yet

---

## Console Checks

**Expected log sequences:**

### On Logout:
```
[logout] Cleared shift state via exitShiftNoArchive()
[logout] Cleared namespaced main via Storage.saveMain
[logout] Cleared namespaced learned UL via Storage.saveLearnedUL
[logout] Cleared namespaced custom codes via Storage.saveCustomCodes
[logout] Cleared pending ops queue
[logout] Full reset complete - redirecting to login
```

### On Login (Fresh):
```
[Boot] Attempting to sync pending operations...
[Boot] Backend load failed, continuing local-only
[Storage] Loaded data for user <userId>: 0 history records
[loadAll] ✓ Initialized blank state for user <userId>
```

### On Login (Restored):
```
[Boot] Attempting to sync pending operations...
[Storage] Loaded data for user <userId>: <N> history records
[loadAll] ✓ Loaded <N> history records for user <userId>
Shift restored – continue where you left off
```

### On bfcache Restore:
```
[iOS bfcache] Page restored from cache, re-validating auth...
[iOS bfcache] Auth valid after restore, continuing...
```

---

## Troubleshooting

### Issue: Blank screen persists after logout
**Check:**
- Is this iOS Safari/PWA? (Fix is iOS-specific)
- Console shows: `gateWqtByLogin` ran before `DOMContentLoaded`?
- Verify `index.html` changes are deployed

### Issue: User data bleeds between accounts
**Check:**
- Console shows: `[Storage] User switch detected`?
- Console shows: `[Storage] Cleared old user namespaced keys`?
- Verify `storage.js` changes are deployed

### Issue: bfcache restore breaks auth
**Check:**
- Console shows: `[iOS bfcache] Page restored from cache`?
- Event listener for `pageshow` registered?
- Verify `boot.js` changes are deployed

---

## Sign-Off

**Tester Name:** ___________________  
**Date:** ___________________  
**Build/Commit:** `4fc202c`  
**Overall Result:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  

**Notes:**
```
(Add any additional observations or issues found during testing)
```

---

**Test Complete** ✅
