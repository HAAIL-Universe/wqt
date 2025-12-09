# Shift Cleanup & Logout Testing Guide

## Overview
This document outlines regression tests to verify that shift end and logout operations properly clean all state, preventing ghost data and phantom shifts.

## Changes Implemented

### 1. `endShift()` in `core-tracker-history.js`
**What changed:**
- After enqueueing the shift archive, explicitly calls `exitShiftNoArchive()` to clear in-memory state
- Calls `saveAll()` to persist the cleared state to localStorage
- Sets `shiftActive` flag to `'0'` as final safety measure

**Expected behavior:**
- All shift data (picks, current, shiftBreaks, etc.) cleared from memory
- localStorage immediately reflects cleared state
- UI shows "Start shift" state
- No completed orders visible when starting a new shift

### 2. `exitShiftNoArchive()` in `core-state-ui.js`
**What changed:**
- Clears `operativeLog` array and `operativeActive` object
- Explicitly removes side-channel localStorage keys:
  - `shiftNotes`
  - `shiftDelays`
  - `currentOrder`
  - `breakDraft`
  - `sharedBlock`
  - `sharedDockOpen`
  - `sharedMySum`
- Resets summary chips (Live Rate and Perf Score) to `—`
- Calls `saveAll()` to persist cleared state

**Expected behavior:**
- All operational logs cleared
- All shift-specific localStorage keys removed
- UI shows default "no data" state (`—` for metrics)
- State persisted immediately to localStorage

### 3. `logoutAndReset()` in `boot.js`
**What changed:**
- Calls `exitShiftNoArchive()` at the start (before clearing localStorage)
- Suppresses the "complete current order" alert during logout
- Proceeds with existing identity and state clearing logic

**Expected behavior:**
- Shift state cleared before user identity removal
- All localStorage keys removed (both namespaced and legacy)
- Clean redirect to login screen
- No partial state remains after logout

---

## Test Scenarios

### Scenario A: Normal Shift End & Archive

#### Setup
1. Log in as a picker
2. Start shift (note the start time)
3. Complete 2-3 orders with various metrics:
   - Record units, locations
   - Add breaks/lunches
   - Log some wrap time

#### Execute
1. Click "End shift & archive"
2. Confirm archive action

#### Verification Checklist
- [ ] History tab shows new shift snapshot with correct date
- [ ] History snapshot includes all completed orders
- [ ] Tracker tab shows "Start shift" card (not active shift UI)
- [ ] Live Rate chip shows `—`
- [ ] Perf Score chip shows `—`
- [ ] `localStorage.shiftActive` equals `"0"`
- [ ] `localStorage.currentOrder` is removed
- [ ] `localStorage.shiftNotes` is removed
- [ ] `localStorage.shiftDelays` is removed
- [ ] `localStorage.shiftBreaks` is part of empty state

#### Start New Shift
5. Click "Start shift" again
6. Complete an order

**Expected:**
- [ ] No orders from previous shift appear
- [ ] `picks` array contains only the new order
- [ ] Daily totals start from 0
- [ ] Performance metrics calculate from new shift only

---

### Scenario B: Logout Without Ending Shift

#### Setup
1. Log in as a picker
2. Start shift
3. Complete 1-2 orders
4. Do NOT end the shift

#### Execute
1. Click "Logout" (or navigate to logout action)

#### Verification Checklist
- [ ] No "complete current order" alert appears
- [ ] Redirected to `login.html`
- [ ] All localStorage keys cleared:
  - [ ] `WQT_CURRENT_USER`
  - [ ] `wqt_operator_id`
  - [ ] `wqt_username`
  - [ ] `wqt_v2722_data` (or namespaced equivalent)
  - [ ] `shiftActive`
  - [ ] `currentOrder`
  - [ ] `shiftNotes`
  - [ ] `shiftDelays`
  - [ ] `sharedBlock`
  - [ ] `sharedDockOpen`

#### Re-login
5. Log back in as the same user

**Expected:**
- [ ] No active shift in progress
- [ ] Tracker shows "Start shift" state
- [ ] No phantom orders from previous session
- [ ] No partial/ghost state (no "resume" prompt)
- [ ] `picks` array is empty
- [ ] `current` is `null`
- [ ] Summary chips show `—`

---

### Scenario C: Exit Shift Without Archive (Edge Case)

#### Setup
1. Log in as a picker
2. Start shift
3. Complete 1 order

#### Execute
1. Use "Exit shift" (if available) instead of "End shift & archive"

#### Verification Checklist
- [ ] Shift state cleared (no archive created)
- [ ] History does NOT show a new entry for today
- [ ] Tracker shows "Start shift" state
- [ ] All localStorage keys cleared (same as Scenario A)
- [ ] UI resets to default state

---

### Scenario D: Logout With Active Order

#### Setup
1. Log in as a picker
2. Start shift
3. Start an order but do NOT complete it (leave `current` populated)

#### Execute
1. Click "Logout"

#### Verification Checklist
- [ ] No alert blocking logout
- [ ] `current` order is cleared during logout
- [ ] Logout proceeds successfully
- [ ] Redirected to login screen

#### Re-login
5. Log back in

**Expected:**
- [ ] No active order in progress
- [ ] No partial order data
- [ ] Tracker in clean "Start shift" state

---

### Scenario E: Multiple Shifts Same Day

#### Setup
1. Log in as a picker
2. Start shift → complete orders → End shift & archive
3. Immediately start a new shift

#### Execute
1. Complete 1-2 orders in the new shift
2. End shift & archive again

#### Verification Checklist
- [ ] History shows TWO separate shift entries for today
- [ ] Each entry has correct timestamps (start/end)
- [ ] Each entry has independent totals
- [ ] No data leakage between shifts
- [ ] Second shift metrics don't include first shift data

---

## Console Inspection

After each scenario, check browser console for these log messages:

### End Shift
```
[endShift] Enqueued END_SHIFT_ARCHIVE operation
[exitShiftNoArchive] Cleared all shift-specific localStorage keys
[exitShiftNoArchive] Persisted cleared state via saveAll()
[endShift] Shift state fully cleared and persisted
[saveAll] Saved via Storage.saveMain (namespaced blob)
```

### Logout
```
[logout] Cleared shift state via exitShiftNoArchive()
[exitShiftNoArchive] Cleared all shift-specific localStorage keys
[exitShiftNoArchive] Persisted cleared state via saveAll()
[logout] Cleared namespaced main via Storage.saveMain
[logout] Cleared namespaced learned UL via Storage.saveLearnedUL
[logout] Cleared namespaced custom codes via Storage.saveCustomCodes
[logout] Full reset complete - redirecting to login
```

---

## Known Edge Cases

### Offline Archive
If offline when ending shift:
- Archive operation enqueued in pending ops
- State still clears locally
- Archive syncs when connection restored
- Verify pending ops queue contains `END_SHIFT_ARCHIVE`

### Browser Refresh During Active Shift
- If shift active and user refreshes:
  - `shiftActive` flag should be `"1"`
  - State should restore from localStorage
  - No ghost data from previous shifts

### Concurrent Users (Same Device)
- Each user has namespaced localStorage keys
- Logout clears current user's namespace
- Other user data unaffected
- Verify keys like `wqt_v2722_data__u_<userId>`

---

## Regression Failures to Watch For

❌ **Ghost Orders**: Completed orders from previous shift appear in new shift
❌ **Phantom Shift**: App thinks shift is active when it shouldn't be
❌ **Stale Metrics**: Performance chips show old data after clearing
❌ **Persistent Current**: `current` order resurrects after logout
❌ **localStorage Leakage**: Side-channel keys (`shiftNotes`, `sharedBlock`) not cleared
❌ **UI Mismatch**: Shift ended but UI still shows active order cards
❌ **Archive Duplication**: Same shift archived multiple times

---

## Success Criteria

✅ All scenarios pass without ghost data
✅ localStorage reflects cleared state immediately after operations
✅ UI consistently shows correct state (active vs. no shift)
✅ Re-login after logout shows clean slate
✅ Console logs confirm all cleanup steps executed
✅ No alerts block logout flow
✅ Summary chips reset to `—` when shift ends
✅ History correctly archives shift data

---

## Automated Test Hooks (Future)

For automated testing, consider checking these programmatically:

```javascript
// After endShift() or exitShiftNoArchive()
assert(picks.length === 0);
assert(current === null);
assert(localStorage.getItem('shiftActive') === '0');
assert(localStorage.getItem('currentOrder') === null);
assert(localStorage.getItem('shiftNotes') === null);
assert(document.getElementById('live-rate-value').textContent === '—');
assert(document.getElementById('perf-score-value').textContent === '—');

// After logoutAndReset()
assert(localStorage.getItem('WQT_CURRENT_USER') === null);
assert(localStorage.getItem('shiftActive') === null);
assert(window.location.pathname.endsWith('login.html'));
```

---

## Notes

- Run these tests in both online and offline modes
- Test on multiple browsers (Chrome, Firefox, Edge)
- Test on mobile devices if applicable
- Clear browser cache between test runs for cleanest results
- Use DevTools → Application → Local Storage to inspect state
- Use DevTools → Console to verify log messages
