// --- Performance Points Per Hour Calculation ---
// Computes (units + 2*locations) per hour for today/shift
// Uses ACTIVE time only (excludes all logged downtime: breaks, wraps, delays)
function computePerformancePointsPerHourToday() {
  if (!Array.isArray(picks) || !picks.length) return null;
  
  // 1) Sum score AND active hours over all completed orders
  let totalScore = 0;
  let totalActiveHours = 0;
  
  for (const o of picks) {
    if (!o.start || !o.close) continue;
    
    const units = o.units ?? o.totalUnits ?? o.qty ?? 0;
    const locations = o.locations ?? o.totalLocations ?? 0;
    const orderScore = units + locations * 2;
    
    // Calculate active hours for this order (excluding breaks AND wraps)
    const s = hm(o.start);
    const e = hm(o.close);
    const excl = (o.log && Array.isArray(o.log.breaks))
      ? o.log.breaks.reduce((a,b)=>a+(b.minutes||0),0)
      : (o.excl || 0);
    
    // Add wrap downtime
    const wrapMins = (o.log && Array.isArray(o.log.wraps))
      ? o.log.wraps.reduce((acc, w) => acc + ((w.durationMs || 0) / 60000), 0)
      : 0;
    
    const activeHours = (e > s) ? (e - s) - (excl + wrapMins)/60 : 0;
    
    if (activeHours > 0) {
      totalScore += orderScore;
      totalActiveHours += activeHours;
    }
  }
  
  if (totalActiveHours <= 0) return null;
  
  // 2) Convert to points per active hour
  return totalScore / totalActiveHours;
}

if (typeof window !== 'undefined') {
  window.computePerformancePointsPerHourToday = computePerformancePointsPerHourToday;
}

// ---- Shift recovery guard bypass (server-active shift found on load) ----
function shiftIsoToHHMM(iso){
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  } catch (_) { return ''; }
}

function setShiftRecoveryMode(on){
  if (typeof window === 'undefined') return;
  window.__SHIFT_RECOVERY_ACTIVE = !!on;
}

function isShiftRecoveryMode(){
  return (typeof window !== 'undefined') && window.__SHIFT_RECOVERY_ACTIVE === true;
}

if (typeof window !== 'undefined') {
  window.enableShiftRecoveryMode = (meta)=>{
    setShiftRecoveryMode(true);
    // Seed startTime hint if we lack one, using server shift start
    if (meta?.started_at && typeof window !== 'undefined') {
      const existingStart = window.startTime || '';
      if (!existingStart) {
        const hhmm = shiftIsoToHHMM(meta.started_at);
        if (hhmm) {
          window.startTime = hhmm;
          try { startTime = hhmm; } catch (_) {}
        }
      }
    }
  };
  window.clearShiftRecoveryMode = () => setShiftRecoveryMode(false);
  window.isShiftRecoveryMode = isShiftRecoveryMode;
}
// --- Performance Score Calculation ---
// Computes performance score for today/shift: (units + locations*2) / active minutes
// Uses ACTIVE time only (excludes all logged downtime: breaks, wraps, delays)
function computePerformanceScoreForToday() {
  if (!Array.isArray(picks) || !picks.length) return null;
  let dailyScore = 0;
  let dailyActiveMinutes = 0;
  
  for (const o of picks) {
    // Only count orders with both start and close times
    if (!o.start || !o.close) continue;
    
    const units = Number(o.units) || 0;
    const locations = Number(o.locations) || 0;
    const orderScore = units + (locations * 2);
    
    // Compute ACTIVE minutes (excluding breaks AND wraps)
    const s = hm(o.start);
    const e = hm(o.close);
    const excl = (o.log && Array.isArray(o.log.breaks))
      ? o.log.breaks.reduce((a,b)=>a+(b.minutes||0),0)
      : (o.excl || 0);
    
    // Add wrap downtime
    const wrapMins = (o.log && Array.isArray(o.log.wraps))
      ? o.log.wraps.reduce((acc, w) => acc + ((w.durationMs || 0) / 60000), 0)
      : 0;
    
    const activeMinutes = ((e > s) ? (e - s) * 60 : 0) - excl - wrapMins;
    
    if (activeMinutes > 0) {
      dailyScore += orderScore;
      dailyActiveMinutes += activeMinutes;
    }
  }
  
  if (dailyActiveMinutes <= 0) return null;
  return dailyScore / dailyActiveMinutes;
}

// Export for UI
if (typeof window !== 'undefined') {
  window.computePerformanceScoreForToday = computePerformanceScoreForToday;
}
// ================= Overlay Role UI =================
function renderRoleChips() {
  const primaryChip  = document.getElementById('rolePrimaryChip');
  const overlayChip  = document.getElementById('roleOverlayChip');
  const reqBtn       = document.getElementById('btnRequestOverlay');
  const supervisorTabBtn = document.getElementById('tabSupervisorBtn');
  const warehouseToolsCard = document.getElementById('warehouseToolsCard');

  // Determine primary role from logged-in identity, default to picker
  const identity = WqtAPI.getLoggedInUserIdentity?.();
  const primaryRole = (identity && identity.role)
    ? String(identity.role).toLowerCase()
    : 'picker';
  const primaryRoleLabel = primaryRole.charAt(0).toUpperCase() + primaryRole.slice(1);
  if (primaryChip) primaryChip.textContent = `Role: ${primaryRoleLabel}`;

  const overlaySession = WqtAPI.loadOverlaySession?.();
  const overlay = (overlaySession && overlaySession.role)
    ? overlaySession
    : (WqtAPI.overlayRole?.role ? WqtAPI.overlayRole : null);

  if (overlay && overlay.role) {
    overlayChip.classList.remove('hidden');
    overlayChip.textContent = `Overlay: ${overlay.role}`;
    
    // Show supervisor tab if overlay role is supervisor
    if (overlay.role === 'supervisor' && supervisorTabBtn) {
      supervisorTabBtn.style.display = 'inline-block';
    }
  } else {
    overlayChip.classList.add('hidden');
    // Hide supervisor tab when no supervisor overlay
    if (supervisorTabBtn) supervisorTabBtn.style.display = 'none';
  }
  
  const overlayRole = overlay?.role;
  const overlayAllowsWarehouseMap = overlayRole === 'operative' || overlayRole === 'supervisor';
  const primaryAllowsWarehouseMap = primaryRole === 'operative' || primaryRole === 'supervisor';
  const hasMapAccess = primaryAllowsWarehouseMap || overlayAllowsWarehouseMap;
  const isSupervisorPage = window.location.pathname.includes('super.html');
  if (warehouseToolsCard) {
    warehouseToolsCard.style.display = (hasMapAccess && !isSupervisorPage)
      ? 'block'
      : 'none';
  }
}

function openOverlayModal() {
  document.getElementById('overlayRoleModal').style.display = 'flex';
  document.getElementById('overlayPinInput').value = '';
  document.getElementById('overlayStatus').textContent = '';
}

function closeOverlayModal() {
  document.getElementById('overlayRoleModal').style.display = 'none';
}

async function submitOverlayLogin() {
  const role = document.getElementById('overlayRoleSelect').value.toLowerCase();
  const pin  = document.getElementById('overlayPinInput').value.trim();
  const status = document.getElementById('overlayStatus');

  if (!pin) { status.textContent = "Enter a PIN."; return; }

  try {
    status.textContent = "Checking…";
    const resp = await fetch('/auth/role_access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, pin_code: pin })
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('Role access failed', resp.status, text);
      status.textContent = 'Role access failed. Check PIN / role.';
      return;
    }

    const data = await resp.json();

    if (data.ok) {
      // Example: mark that a supervisor/operative overlay is active
      WqtAPI.overlayRole = {
        role: data.role,
        displayName: data.display_name,
        userId: data.user_id
      };
      status.textContent = `${data.role} access unlocked for ${data.display_name}`;
      renderRoleChips();
      setTimeout(closeOverlayModal, 600);
    } else {
      status.textContent = 'Role access denied.';
    }
  } catch(err) {
    status.textContent = err.message || "Access denied.";
  }
}

function endOverlaySessionUI() {
  WqtAPI.clearOverlaySession?.();
  renderRoleChips();
  showToast?.("Overlay ended");
}
// ====== Tracker core ======

// Round current time to nearest hour (for quick baseline start)
function snapToNearestHour(){
  const d = new Date();
  let h = d.getHours();
  if (d.getMinutes() >= 30) h = (h + 1) % 24;
  return String(h).padStart(2,'0') + ':00';
}

// Entrypoint when user taps Start 9h / Start 10h
function startShift(lenHours){
  try {
    // Persist one-time 9h/10h preference
    const existing = getShiftPref();
    const chosen = existing || (lenHours | 0);
    if (!existing && (chosen === 9 || chosen === 10)) setShiftPref(chosen);

    // Seed hidden length field for downstream logic
    const applyLen = getShiftPref() || (lenHours || 9);
    const lenEl = document.getElementById('tLen');
    if (lenEl) lenEl.value = String(applyLen);

    // Defer actual start to the contracted time picker
    openContractedStartPicker();
  } catch (e){
    // Safe fallback: still route through the picker
    const lenEl = document.getElementById('tLen');
    if (lenEl) lenEl.value = String(lenHours || 9);
    openContractedStartPicker();
  }
}

// Transition into main tracker cards after a start time is determined
function beginShift(){
  if (!startTime) startTime = snapToNearestHour();
  pickingCutoff = "";
  // Clean any pre-shift hints/notes
  clearStartHint?.();
  // Onboarding trigger — shift started
  Onboard.showHint("shiftStarted", "Shift started. You can now open a customer order.");
  // Show tracker UI
  const shift = document.getElementById('shiftCard');
  const active = document.getElementById('activeOrderCard');
  const done = document.getElementById('completedCard');
  if (shift)  shift.style.display = 'none';
  if (active) active.style.display = 'block';
  if (done)   done.style.display = 'block';
  const shiftLog = document.getElementById('shiftLogCard');
  if (shiftLog) shiftLog.style.display = 'block';
  // Header form visible until an order starts
  const hdrForm = document.getElementById('orderHeaderForm');
  const hdrProg = document.getElementById('orderHeaderProgress');
  if (hdrForm) hdrForm.style.display = '';
  if (hdrProg) hdrProg.style.display = 'none';
    // Onboarding trigger — explain order header
  Onboard.showHint("orderHeader", "Choose a customer and enter total units to begin an order.");

  // Hide order-only buttons until active
  ['btnDelay','btnUndo','btnB','btnL','btnCloseEarly'].forEach(id=>{
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });

  const chipBox = document.getElementById('chipElapsed');
  if (chipBox) chipBox.style.display = 'none';

  renderDone();
  updateSummary?.();
  if (typeof refreshSummaryChips === 'function') refreshSummaryChips(); // Ensure chips are in sync
  updateDelayBtn?.();
  updateEndShiftVisibility?.();
  updateCloseEarlyVisibility?.();
  updateExitShiftVisibility?.();

  // Ensure live banner appears on Tracker now that a shift is active
  if (typeof showTab === 'function') showTab('tracker');

  saveAll();

  // Lock the bottom action row layout
  ensureActionRowLayout?.();
}


// --- 12h time helpers (no seconds) ---
// Simple hour label for buttons (7am / 12pm etc.)
function to12hLabel(hh, mm='00') {
  let H = parseInt(hh, 10);
  const ap = (H >= 12) ? 'pm' : 'am';
  H = ((H + 11) % 12) + 1;      // 0 → 12, 13 → 1
  return `${H}${ap}`;           // 7am, 12pm
}

// "HH:MM" → 12h string with optional minutes (7am / 11:43am)
function hmTo12(hm){
  const [h, mRaw] = String(hm||'').split(':');
  const H = parseInt(h, 10) || 0;
  const M = parseInt(mRaw, 10) || 0;
  const ap = (H >= 12) ? 'pm' : 'am';
  const hour12 = ((H + 11) % 12) + 1;
  // show minutes only if non-zero or explicitly requested
  return (M === 0)
    ? `${hour12}${ap}`          // 7am … 12pm
    : `${hour12}:${String(M).padStart(2,'0')}${ap}`; // 11:43am
}

// Contracted start modal: build 6 hour buttons around current hour
function openContractedStartPicker(){
  const modal = document.getElementById('contractModal');
  const list  = document.getElementById('contractHourList');
  if (!modal || !list) return;

  list.innerHTML = '';

  // Base at the current hour (FLOOR) so offsets are stable
  const now = new Date();
  const mins = now.getMinutes();
  const snapped = new Date(now);
  snapped.setMinutes(0, 0, 0); // 11:20 -> 11:00, 11:45 -> 11:00

  // Option B: if we're past the top of the hour, include +1h and highlight it.
  // Keep exactly 6 buttons.
  const justOnHour = (mins === 0);
  const OFFSETS = justOnHour ? [-5, -4, -3, -2, -1, 0] : [-4, -3, -2, -1, 0, +1];
  const HIGHLIGHT = justOnHour ? 0 : +1;

  OFFSETS.forEach(off => {
    const d = new Date(snapped);
    d.setHours(d.getHours() + off);

    const hh = String(d.getHours()).padStart(2, '0');
    const mm = '00';

    const btn = document.createElement('button');
    btn.className = 'btn';
    if (off === HIGHLIGHT) btn.classList.add('ok'); // highlight per Option B
    btn.type = 'button';
    btn.textContent = to12hLabel(hh, mm);                // plain hour text
    btn.onclick = () => applyContractedStart(`${hh}:${mm}`);
    list.appendChild(btn);
  });

  modal.style.display = 'flex';
}

// Simple close for contracted-start modal
function closeContractModal(){
  const modal = document.getElementById('contractModal');
  if (modal) modal.style.display = 'none';
}

// Apply a chosen contracted start time, log lateness, move into S2
async function applyContractedStart(hh){
  closeContractModal();

  // Normalize input: allow "11" or "11:00"
  let contractedHM;
  if (typeof hh === 'string' && hh.includes(':')) {
    contractedHM = hh.slice(0,5);                   // "HH:MM"
  } else {
    const H = parseInt(hh, 10);
    const HH = Number.isFinite(H) ? String(H).padStart(2,'0') : '00';
    contractedHM = `${HH}:00`;
  }

  // Read the shift length (9h or 10h) from the hidden field set by the button
  const lenEl = document.getElementById('tLen');
  const chosenLen = lenEl ? (parseInt(lenEl.value, 10) || 9) : 9;
  if (lenEl) lenEl.value = String(chosenLen);

  const actualHM  = nowHHMM();
  const cMin = hmToMin(contractedHM);
  const aMin = hmToMin(actualHM);

  // Effective start: contracted if on-time/early; actual if late
  const effectiveMin = (aMin <= cMin) ? cMin : aMin;
  const effectiveHM  = minToHm(effectiveMin);

  // Live rate baseline
  startTime = effectiveHM;

  // Log lateness
  const lateMin = aMin - cMin;
  try {
    const day = new Date().toISOString().slice(0,10);
    const raw = localStorage.getItem(LATE_LOG_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj[day] = {
      contracted: contractedHM,
      actual: actualHM,
      effective: effectiveHM,
      lateMin,
      shiftLen: chosenLen
    };
    localStorage.setItem(LATE_LOG_KEY, JSON.stringify(obj));
  } catch(e) {}

  // Try to start server session before entering S2
  try {
    const started = await (window.WqtAPI?.startShiftSession?.({
      startHHMM: effectiveHM,
      shiftLengthHours: chosenLen,
    }));
    const meta = (started && started.shift) ? started.shift : started;
    persistActiveShiftMeta?.(meta || null);
    localStorage.setItem('shiftActive','1');
  } catch (err) {
    console.error('[ShiftStart] Failed to start shift on server', err);
    showToast?.('Could not start shift on server. Check connection and retry.');
    startTime = '';
    return;
  }

  // Show S2 (customer selection) view
  beginShift();
  if (typeof updateSummary === 'function') updateSummary();

  // S2 note (left side near Log/Delay), formatted nicely
  const contracted12 = hmTo12?.(contractedHM) || contractedHM;
  const actual12     = hmTo12?.(actualHM)     || actualHM;
  const noteText = lateMin > 0 ? `${lateMin}m late`
                 : lateMin < 0 ? `${-lateMin}m early`
                 : 'on time';
  showPreOrderNote?.(`Contracted ${contracted12} • Actual ${actual12} (${noteText})`);
}

// Enable/disable Start + Shared Start buttons based on customer + units
function refreshStartButton(){
  const sel   = document.getElementById('oCust');
  const other = document.getElementById('oOther');
  const total = parseInt(document.getElementById('oTotal').value||'0',10);
  // Optional: read locations to allow UI to re-evaluate when it changes.
  const locations = parseInt((document.getElementById('order-locations')?.value || '0'), 10);
  const hasCust = sel.value && sel.value!=='__OTHER__' ||
                  (sel.value==='__OTHER__' && /^[A-Z]{6}$/.test((other.value||'').toUpperCase()));
  const ok = hasCust && total>0;

  const btn = document.getElementById('btnStart');
  if (btn) btn.disabled = !ok;

  // NEW: mirror state to Shared Pick
  const sharedBtn = document.getElementById('btnSharedStart');
  if (sharedBtn) sharedBtn.disabled = !ok;
}
// --- NEW: Unified Break Logic ---
function openBreakChoiceModal() {
  document.getElementById('breakChoiceModal').style.display = 'flex';
}

function closeBreakChoiceModal() {
  document.getElementById('breakChoiceModal').style.display = 'none';
}

function confirmStartBreak(kind) {
  closeBreakChoiceModal();
  startBreak(kind);
  // FORCE SYNC: Sends "Active Break" status to Admin Dashboard immediately
  if (typeof saveAll === 'function') saveAll();
}
// Restores correct UI when page loads or state changes
function restoreActiveOrderUI() {
  const shiftOn  = !!startTime && window.archived !== true;
  const inOrder  = !!(shiftOn && current && Number.isFinite(current.total));

  const hdrForm   = document.getElementById('orderHeaderForm');
  const hdrProg   = document.getElementById('orderHeaderProgress');
  const orderArea = document.getElementById('orderArea');

  const show = (id, on, disp = 'inline-block') => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = on ? disp : 'none';
  };

  if (inOrder) {
    // Swap headers
    if (hdrForm && hdrProg) {
      if (typeof fadeSwap === 'function') fadeSwap(hdrForm, hdrProg, 'flex');
      else { hdrForm.style.display = 'none'; hdrProg.style.display = 'flex'; }
    }
    if (orderArea) orderArea.style.display = 'block';

    // ⛔ Remove any pre-order Contracted/Actual note when an order is active
    const cn = document.getElementById('contractNote');
    if (cn && cn.parentNode) cn.parentNode.removeChild(cn);

    // Sync form inputs / dropdown label
    const sel = document.getElementById('oCust');
    if (sel && current.name) sel.value = current.name;
    const tot = document.getElementById('oTotal');
    if (tot && Number.isFinite(current.total)) tot.value = String(current.total);
    const ddToggle = document.querySelector('#oDD .dd-toggle');
    if (ddToggle && current.name) ddToggle.textContent = current.name;

    // Seed progress header fields
    const total    = current.total || 0;
    const lastLeft = tempWraps.length ? tempWraps[tempWraps.length - 1].left : total;
    const done     = total - lastLeft;
    const pct      = total ? Math.round((done / total) * 100) : 0;

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('progCust', current.name || '—');
    setTxt('progQty',  total);
    setTxt('progLeft', lastLeft);
    setTxt('progPallets', String(tempWraps.length));
    setTxt('progPct', pct + '%');
    const fill = document.getElementById('progFill'); if (fill) fill.style.width = pct + '%';

    // Gated controls (order-only)
    show('btnStart',       false);
    show('btnUndo',        true);
    show('btnBreakMenu',   true);
    show('btnDelay',       true);
    show('btnCloseEarly',  true);

    // Elapsed chip visible during order
    const chipBox = document.getElementById('chipElapsed');
    if (chipBox) chipBox.style.display = '';

    // Repaint dynamic pieces
    updateProgressHeader?.();
    renderTimeline?.();
    refreshWrapButton?.();
    refreshCompleteButton?.();

    // ---- Shared dock: persist visibility on restore ----
    try {
      const dock = document.getElementById('sharedDock');
      const shouldShow = !!(current?.shared) && localStorage.getItem('sharedDockOpen') !== '0';
      if (dock) dock.style.display = shouldShow ? 'flex' : 'none';
      if (shouldShow) {
        updateSharedDockInfo?.();
        // (optional) focus units input for quick resume
        setTimeout(() => document.getElementById('sharedUnitsDock')?.focus(), 0);
      }
    } catch(e){}

    // ===== Predictive resume on refresh =====
    try {
      predictiveStop?.();
      const firstWrapSeen = Array.isArray(tempWraps) && tempWraps.length > 0;
      const totalUnits    = current.total || 0;
      const lastUnitsLeft = firstWrapSeen
        ? tempWraps[tempWraps.length - 1].left
        : totalUnits;

      let seedRate;
      if (firstWrapSeen) {
        seedRate = Math.round(
          (typeof orderLiveRate === 'function' && orderLiveRate()) ||
          (typeof getLiveRateUh  === 'function' && getLiveRateUh()) ||
          280
        );
      } else {
        seedRate = (typeof isFirstOrderToday === 'function' && isFirstOrderToday())
          ? 280
          : Math.round(
              (typeof getLiveRateUh === 'function' && getLiveRateUh()) ||
              280
            );
      }

      if (lastUnitsLeft > 0) {
        predictiveReset?.(lastUnitsLeft, seedRate, firstWrapSeen);
        uiLastPaceUh = Math.round(predictive?.rateUh || 0) || seedRate;
        predictiveStart?.();
      } else {
        predictiveStop?.();
      }
    } catch(e) {}
  } else {
    // S1/S2: show form, hide progress/area
    if (hdrProg)   hdrProg.style.display = 'none';
    if (orderArea) orderArea.style.display = 'none';
    if (hdrForm)   hdrForm.style.display = '';

    // Restore contracted note on S1 only (pre-order)
    renderPreOrderNoteFromLog?.();

    // Buttons hidden when idle; Delay/Close-Early only when shift is on
    show('btnStart',        true);
    show('btnUndo',         false);
    show('btnBreakMenu',    shiftOn);
    show('btnDelay',        shiftOn);
    show('btnCloseEarly',   shiftOn);

    // Hide elapsed chip
    const chipBox2 = document.getElementById('chipElapsed');
    if (chipBox2) chipBox2.style.display = 'none';

    // No active order: shared bar should NOT be visible
    persistSharedPadOpen(false);
    updateSharedDockInfo?.();

    predictiveStop?.();
  }

  // Always resync top controls and keep action row grouped
  updateHeaderActions?.();
  ensureActionRowLayout?.();
}

// Create a new active order from S2 form
function startOrder() {
  const sel   = document.getElementById('oCust');
  const name  = sel ? sel.value : '';
  const totalInput = document.getElementById('oTotal');
  const locsInput = document.getElementById('order-locations');
  
  const total = parseInt((totalInput?.value || '0'), 10);
  const locations = parseInt((locsInput?.value || '0'), 10);

  if (!startTime) return alert('Set shift start before starting an order.');
  pickingCutoff = ""; // resume counting time if we start picking again
    // Onboarding trigger — order started
  Onboard.showHint("orderStarted", "Order started. Your timer is running. Log wraps as you go.");

  const otherVal = (document.getElementById('oOther')?.value || '').toUpperCase();
  const isOther  = (name === '__OTHER__');
  const hasValidOther = /^[A-Z]{6}$/.test(otherVal);

  if (!(name && name !== '__OTHER__') && !(isOther && hasValidOther)) {
    return alert('Select a valid customer code');
  }

  // ====== VALIDATION: Units ======
  if (!total || isNaN(total) || total <= 0) {
    if (totalInput) totalInput.focus();
    return alert('Enter a valid number of units (must be greater than 0)');
  }

  // ====== VALIDATION: Locations ======
  if (isNaN(locations) || locations <= 0) {
    if (locsInput) locsInput.focus();
    return alert('Enter a valid number of locations (must be greater than 0)');
  }

  // ====== CRITICAL VALIDATION: Locations cannot exceed Units ======
  if (locations > total) {
    if (locsInput) {
      locsInput.focus();
      locsInput.select();
    }
    return alert('Locations can\'t be higher than units. Please check your totals.');
  }

  const finalName = isOther ? otherVal : name;

  // create order state
  current = {
    name: finalName,
    total,
    locations,
    start: nowHHMM(),
    breaks: [],
    notes: [],
    // rate/ETA controlled only by Start + Log Wrap
    preWrapRateUh: null,
    orderRateUh: null,
    fixedETA: null,
    shared: false,  // Shared mode flag (set in openSharedStart())
  };
  tempWraps = [];
  undoStack = [{ type: 'start' }];

  // --- Seed from Live Rate chip if available ---
  (function seedFromLiveRate(){
    const chip = document.getElementById('chipRateVal');
    let liveUh = 0;
    if (chip) {
      const m = String(chip.textContent || '').match(/(\d+)/);
      liveUh = m ? parseInt(m[1], 10) : 0;
    }
    if (Number.isFinite(liveUh) && liveUh > 0) {
      current.preWrapRateUh = liveUh;
      const mins = Math.round((total / liveUh) * 60);
      current.fixedETA = addMinutesToNow ? addMinutesToNow(mins) : nowHHMM();
    } else {
      current.preWrapRateUh = null;
      current.fixedETA = null;
    }
  })();

  // Swap to Active Open Order using the canonical path
  try { restoreActiveOrderUI?.(); } catch (e) {}

  // Belt-and-braces card visibility
  (function ensureCards(){
    const shiftCard  = document.getElementById('shiftCard');
    const activeCard = document.getElementById('activeOrderCard');
    const doneCard   = document.getElementById('completedCard');
    if (shiftCard)  shiftCard.style.display  = 'none';
    if (activeCard) activeCard.style.display = 'block';
    if (doneCard)   doneCard.style.display   = 'none';
  })();

  

  // Paint seeded rate/ETA immediately (frozen until Log Wrap)
  const rEl = document.getElementById('progRate');
  const eEl = document.getElementById('progETA');
  if (rEl) {
    const seedRate = current.orderRateUh ?? current.preWrapRateUh;
    rEl.textContent = (seedRate && seedRate > 0) ? `${seedRate} u/h` : '—';
  }
  if (eEl) eEl.textContent = current.fixedETA || '—';

  // Keep predictive paint (width tint etc.) alive if you still want it
  try {
    const totalUnits = total || 0;
    const seed = Math.round(current.preWrapRateUh || (getLiveRateUh?.() || 0) || 280);
    const first = isFirstOrderToday?.() === true;
    if (first) markFirstOrderStarted?.();
    predictiveReset?.(totalUnits, seed, /*firstWrapSeen*/ false);
    uiLastPaceUh = Math.round(predictive?.rateUh || 0) || seed;
    predictiveStart?.();
  } catch (e) {}

  updateProgressHeader?.();
  updateHeaderActions?.();
  ensureActionRowLayout?.();
  saveAll?.();
}
// --- Backend hook: record closed orders (normal + Close Early) ---
function syncClosedOrderToBackend(archivedOrder) {
  try {
    if (window.WqtAPI && typeof WqtAPI.recordClosedOrder === 'function') {
      // Fire-and-forget; backend will attach operator_id / device_id
      WqtAPI.recordClosedOrder(archivedOrder).catch(err => {
        console.warn('[WQT] recordClosedOrder failed', err);
      });
    }
  } catch (e) {
    console.warn('[WQT] syncClosedOrderToBackend error', e);
  }
}

// --- minimal fade swap helper ---
// Generic helper to crossfade two blocks using .fade / .show CSS classes
function fadeSwap(hideEl, showEl, showDisplay = 'block') {
  if (!hideEl || !showEl) return;
  // ensure both have .fade class
  hideEl.classList.add('fade');
  showEl.classList.add('fade');

  // make the target renderable first (so CSS can animate)
  showEl.style.display = showDisplay;

  // hide -> remove .show (fade out)
  hideEl.classList.remove('show');

  // show -> next frame add .show (fade in)
  requestAnimationFrame(() => {
    showEl.classList.add('show');
  });

  // after transition, fully hide the old one
  setTimeout(() => { hideEl.style.display = 'none'; }, 250);
}

// Core pallet wrap logging: validates “units left”, appends wrap, locks ETA
function logWrap() {
  if (!current) return alert('Start an order first');

  const inp = document.getElementById('oLeft');
  const raw = (inp.value || '').trim();
  if (raw === '') { inp.focus(); return alert('Enter units left'); }

  const left = parseInt(raw, 10);
  if (isNaN(left)) { inp.focus(); return alert('Enter a valid number'); }
  if (left < 0 || left > current.total) { inp.focus(); return alert('Units left must be between 0 and total'); }

  const prevLeft = tempWraps.length ? tempWraps[tempWraps.length - 1].left : current.total;
  if (left > prevLeft) { inp.focus(); return alert('Units left cannot increase vs previous wrap'); }

  const done = prevLeft - left;
  if (done <= 0) { inp.focus(); return alert('No progress since last wrap'); }

  // --- NEW: Safety Clean ---
  // Ensure we clear any stuck break drafts or flags because logging a wrap implies we are ACTIVE.
  if (window.breakDraft) {
      try { localStorage.removeItem('breakDraft'); } catch(e){}
      window.breakDraft = null;
  }
  if (current && current.active_break) {
      delete current.active_break;
  }
  // -------------------------

  const t = nowHHMM();
  const endTs = Date.now();
  
  // Calculate wrap duration if we have a start time
  let wrapDurationMs = 0;
  let wrapStartTime = null;
  if (current.wrapActive) {
    wrapStartTime = current.wrapActive.startTime;
    const startTs = current.wrapActive.startTs || endTs;
    wrapDurationMs = Math.max(0, endTs - startTs);
  }
  
  tempWraps.push({ 
    left, 
    done, 
    t,
    startTime: wrapStartTime,
    endTime: t,
    durationMs: wrapDurationMs
  });
  undoStack.push({ type: 'wrap' });
  
  // Clear wrap active state
  if (current.wrapActive) {
    delete current.wrapActive;
  }

  inp.value = '';
  refreshWrapButton();
  renderTimeline();

  // --- STATIC SNAPSHOT & UI SYNC (single-picker) ---
  try {
    const total      = current.total | 0;
    const doneSoFar  = Math.max(0, total - left);                             // ground truth units done
    const elapsedMin = Math.max(1, minutesBetween(current.start, nowHHMM())); // whole-order elapsed (no break subtraction)
    const rateSnap   = Math.round(doneSoFar / (elapsedMin / 60));             // u/h snapshot

    // 1) Freeze per-order rate from snapshot (used by predictive + header)
    current.orderRateUh = rateSnap > 0 ? rateSnap : 0;

    // 2) Re-baseline predictive and keep it aligned with the frozen snapshot
    if (left === 0) {
      // finishing: stop predictive; header/ETA will be handled by complete flow
      predictiveStop?.();
    } else {
      predictiveReset?.(left, current.orderRateUh || undefined);
      if (predictive && current.orderRateUh > 0) predictive.rateUh = current.orderRateUh;
      predictiveStart?.();
      predictiveTick?.();
    }

    // --- sync live chips after a wrap ---
    try { updateSummary?.(); } catch(e){}      // refresh Live Rate + Total Units chips
    try {
      const closedUnits = Array.isArray(picks)
        ? picks.reduce((a,b)=> a + (+b.units || 0), 0)
        : 0;
      const progress    = currentOrderUnitsDone?.() || 0;
      const totalUnits  = closedUnits + progress;
      const chip = document.getElementById('chipTotalVal');
      if (chip) chip.textContent = String(totalUnits);
    } catch(e){}
    try { updateElapsedChip?.(); } catch(e){}  // refresh Elapsed chip
    try { tintProgressByPace?.(current.orderRateUh); } catch(e){} // keep bar color aligned

    // 3) Paint header rate + ETA now so S2 matches modal instantly
    const rEl = document.getElementById('progRate');
    const eEl = document.getElementById('progETA');
    if (current.orderRateUh > 0) {
      const minsLeft = Math.round((left / current.orderRateUh) * 60);
      const etaHHMM  = addMinutesToTime(nowHHMM(), minsLeft);
      if (rEl) rEl.textContent = `${current.orderRateUh} u/h`;
      if (eEl) eEl.textContent = etaHHMM;
    } else {
      rEl?.replaceChildren(document.createTextNode('—'));
      eEl?.replaceChildren(document.createTextNode('—'));
    }
  } catch(e){}

  // 4) Event-driven chips (no lag)
  updateSummary();                 // Live Rate chip repaint (duplicate call vs above, but harmless)
  updateElapsedChip?.();           // Elapsed chip snapshot
  setElapsedChipClickable?.(true);
  refreshCompleteButton();
  if (typeof updateProgressHeader === 'function') updateProgressHeader();
  if (typeof refreshSummaryChips === 'function') refreshSummaryChips(); // Ensure chips are in sync

  // Buttons/complete state
  updateHeaderActions?.();

  // ✅ Auto-close when 0 left - complete order directly
  if (left === 0) {
    showToast?.('Order complete — finishing now');
    setTimeout(() => completeOrder(), 300);
    return;
  }

  saveAll();
}
// Undo wrapper for wraps / breaks / delays / notes (never rewinds past order start)
function undoLast() {
  if (!current) {
    showToast('Nothing to undo');
    return;
  }

  const last = undoStack.pop();
  if (!last) {
    showToast('Nothing to undo');
    return;
  }

  // Never allow Undo to go past the order start
  if (last.type === 'start') {
    undoStack.push(last);                 // restore the sentinel
    showToast('Nothing more to undo');    // user feedback
    return;
  }

  if (last.type === 'wrap') {
    // Remove last wrap (units-left will be recalculated via getCurrentLeft)
    tempWraps.pop();

  } else if (last.type === 'break') {
    // Remove last break / lunch entry from the current order log
    if (Array.isArray(current.breaks) && current.breaks.length) {
      current.breaks.pop();
    }

  } else if (last.type === 'delay' && current.__lastDelay) {
    // Remove the specific delay we just logged
    current.breaks = (current.breaks || []).filter(b => b !== current.__lastDelay);
    current.__lastDelay = null;

  } else if (last.type === 'note') {
    // Remove the last NOTE entry (type: 'N') from the current order log
    if (Array.isArray(current.breaks) && current.breaks.length) {
      for (let i = current.breaks.length - 1; i >= 0; i--) {
        const b = current.breaks[i];
        if (b && b.type === 'N') {
          current.breaks.splice(i, 1);
          break;
        }
      }
    }
  }

  // --- Recompute + repaint ---
  if (typeof updateProgressHeader        === 'function') updateProgressHeader();
  if (typeof renderTimeline              === 'function') renderTimeline();
  if (typeof updateSummary               === 'function') updateSummary();
  if (typeof refreshCompleteButton       === 'function') refreshCompleteButton();
  if (typeof refreshWrapButton           === 'function') refreshWrapButton();
  if (typeof updateDelayBtn              === 'function') updateDelayBtn();
  if (typeof updateEndShiftVisibility    === 'function') updateEndShiftVisibility();
  if (typeof updateCloseEarlyVisibility  === 'function') updateCloseEarlyVisibility();

  // Predictive: re-baseline to latest known left/rate (or stop if no order)
  if (current) {
    const left = (typeof getCurrentLeft === 'function')
      ? getCurrentLeft()
      : (current.left ?? 0);
    const rate = (typeof getLiveRateUh === 'function')
      ? getLiveRateUh()
      : 0;
    if (typeof predictiveReset === 'function') predictiveReset(left, rate);
  } else {
    if (typeof predictiveStop === 'function') predictiveStop();
  }

  if (typeof saveAll === 'function') saveAll();
}

// Enable/disable Complete buttons based on presence of active order
function refreshCompleteButton(){
  ['btnComplete', 'btnCompleteTop'].forEach(id=>{
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !current;
    btn.style.display = current ? 'inline-block' : 'none';
  });
}

// ===== Predictive progress & live ETA =====

// DOM ids for predictive header wiring
const SEL = {
  rateText:  'progRate',   // text: "—" or "823 u/h"
  etaText:   'progETA',    // text: "—" or "17:52"
  leftLabel: 'progLeft',   // text: remaining units
  progFill:  'progFill',   // inner fill div of the progress bar
};

// Current units-left, with shared-session overlay
function getCurrentLeft(){
  if (!current || !current.total) return 0;
  // Base: last wrap's left, or full total if no wraps yet
  let left = tempWraps.length ? tempWraps[tempWraps.length - 1].left : current.total;

  // Shared overlay: reflect in-progress shared submissions (no pallet increment)
  if (current.shared && typeof window._sharedProgressLeft === 'number') {
    left = Math.min(left, window._sharedProgressLeft);
  }

  return Math.max(0, left);
}

// Prefer per-order live rate; fall back to whole-shift snapshot
function getLiveRateUh(){
  const rOrder = Math.round(orderLiveRate() || 0);
  if (rOrder > 0) return rOrder;
  if (typeof computeLiveRateSnapshot === 'function') {
    const snap = computeLiveRateSnapshot();
    if (snap && snap.live > 0) return snap.live;
  }
  return NaN;
}

// (Older-style ETA formatter – not heavily used now)
function fmtETA(ms){
  if (!isFinite(ms)) return '—';
  const d = new Date(ms);
  return d.toTimeString().slice(0,5); // "HH:MM"
}
function setText(id, txt){ const el=document.getElementById(id); if(el) el.textContent = txt; }
function setProgress(pct){
  const el = document.getElementById(SEL.progFill);
  if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}
function updateLeftLabel(left){
  const el = document.getElementById(SEL.leftLabel);
  if (el) el.textContent = String(left);
}

// Seed predictive baseline from current left + rate
function predictiveReset(leftNow, rateUh){
  if (!current || !current.total) return;
  predictive.leftAtBase = Math.max(0, leftNow);
  predictive.baseTs = Date.now();
  predictive.rateUh = Math.max(0, rateUh || getLiveRateUh() || 0);
  predictiveTick(true); // reflect immediately
}
function predictiveStart(){
  predictiveStop();
  predictive.timer = setInterval(predictiveTick, 1000);
}
function predictiveStop(){
  if (predictive.timer) clearInterval(predictive.timer);
  predictive.timer = null;
}

// Minutes to add to ETA while a break/lunch is active.
// At break start we add the full target (20/30). If you overrun, it grows with elapsed.
function breakExtensionMinutes(){
  if (!window.breakDraft) return 0;
  const elapsedMin = Math.round((hm(nowHHMM()) - hm(breakDraft.startHHMM)) * 60);
  const targetMin  = Math.round((breakDraft.targetSec || 0) / 60);
  return Math.max(targetMin, elapsedMin);
}

// Predictive “ghost” progress bar + ETA, using static per-order rate
function predictiveTick(){
  if (!current || !current.total) return;

  // 1) Use static per-order rate if available; DO NOT re-sample live here
  const staticUh = (current && isFinite(current.orderRateUh) && current.orderRateUh > 0)
    ? current.orderRateUh
    : (isFinite(predictive.rateUh) && predictive.rateUh > 0 ? predictive.rateUh : 0);

  // Keep predictive aligned with frozen snapshot to avoid repaint drift
  if (current?.orderRateUh > 0 && predictive && predictive.rateUh !== current.orderRateUh) {
    predictive.rateUh = current.orderRateUh;
  }

  // 2) Predict remaining units from baseline with the static rate
  const perSec     = staticUh > 0 ? (staticUh / 3600) : 0;
  const elapsedSec = (Date.now() - predictive.baseTs) / 1000;

  let leftPred = Math.max(0, Math.round(predictive.leftAtBase - perSec * elapsedSec));
  leftPred = Math.min(leftPred, current.total);

  // 3) Compute progress and paint UI
  const done = (current.total - leftPred);
  const pct  = current.total ? (done / current.total) * 100 : 0;

  // update progress bar + text
  try {
    const fill = document.getElementById('progFill');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    const pctEl = document.getElementById('progPct');
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    const leftLabel = document.getElementById('progLeft');
    if (leftLabel) leftLabel.textContent = String(leftPred);
  } catch(e){}

  // Recompute ETA display using staticUh (keeps end-time stable)
  try {
    if (staticUh > 0) {
      const minsLeft = (leftPred / staticUh) * 60;
      const endHHMM  = addMinutesToTime(nowHHMM(), minsLeft);
      document.getElementById('progRate')?.replaceChildren(document.createTextNode(Math.round(staticUh)+' u/h'));
      document.getElementById('progETA') ?.replaceChildren(document.createTextNode(endHHMM));
    }
  } catch(e){}
  try { updateSummary?.(); } catch(_) {}
  try { tintProgressByPace?.(staticUh); } catch(e){}
}

// Header auto-refresh, but only when predictive is idle
setInterval(()=>{
  // Only let the header repaint if predictive is NOT running
  if (current && !(predictive && predictive.timer)) {
    try { updateProgressHeader(); } catch(e){}
  }
}, 1000);

// Archive + close active order, reset UI to “ready for next order”
function completeOrder() {
  if (!current)   return alert('Start an order first');
  if (!startTime) return alert('Add shift start first');

  const closeHHMM = nowHHMM();

  // Capture final remainder as wrap if we never hit “0 left”
  const total    = current.total || 0;
  const lastLeft = tempWraps.length ? tempWraps[tempWraps.length - 1].left : total;
  if (lastLeft > 0) {
    // Add final wrap with timing if wrap was active
    const endTs = Date.now();
    let wrapDurationMs = 0;
    let wrapStartTime = null;
    
    if (current.wrapActive) {
      wrapStartTime = current.wrapActive.startTime;
      const startTs = current.wrapActive.startTs || endTs;
      wrapDurationMs = Math.max(0, endTs - startTs);
    }
    
    tempWraps.push({ 
      left: 0, 
      done: lastLeft, 
      t: closeHHMM,
      startTime: wrapStartTime,
      endTime: closeHHMM,
      durationMs: wrapDurationMs
    });
    undoStack.push({ type: 'wrap' });
  }

  const palletsCount = tempWraps.length || 1;
  const unitsDone    = total;
  const exclMins     = (current.breaks || []).reduce((a,b)=>a+(b.minutes||0),0);

  // Archive into picks
  const archived = {
    name:    current.name,
    units:   unitsDone,
    locations: current.locations || 0,
    pallets: palletsCount,
    start:   current.start,
    close:   closeHHMM,
    excl:    exclMins,
    log:     { wraps: tempWraps.slice(), breaks: (current.breaks || []).slice() }
  };
  picks.push(archived);
  lastClose = closeHHMM;

  // NEW: push closed-order snapshot to backend (single-picker or shared)
  try {
    syncClosedOrderToBackend(archived);
  } catch (e) {
    console.warn('[WQT] failed to sync closed order', e);
  }


  // Stop prediction & clear state
  predictiveStop();
  current   = null;
  tempWraps = [];
  undoStack = [];

  try { persistSharedPadOpen(false); } catch(e){}

  try {
    // Close the bar and nuke shared-only persistence
    localStorage.setItem('sharedDockOpen','0');
    localStorage.removeItem('sharedMySum');
    localStorage.removeItem('sharedBlock');
    localStorage.removeItem('currentOrder');  // <- critical: stop reviving dead shared orders
  } catch(e){}

  const _pu = document.getElementById('padUnits');
  if (_pu) _pu.value = '';

  // Hide active order UI
  const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  hide('orderArea');
  hide('btnUndo');
  hide('btnComplete');

  // Restore header form (new-order panel), hide progress header
  const hdrForm = document.getElementById('orderHeaderForm');
  const hdrProg = document.getElementById('orderHeaderProgress');
  if (hdrForm && hdrProg) fadeSwap(hdrProg, hdrForm, 'block');

  // Reset inputs & Start button state for a brand-new order
  resetNewOrderForm();

  // Keep Completed Orders section visible and re-render it
  if (typeof renderDone === 'function') renderDone();
  const completedCard = document.getElementById('completedCard');
  if (completedCard) completedCard.style.display = 'block';

  // Update chips and gated actions for "no active order"
  if (typeof updateSummary === 'function') updateSummary();
  if (typeof refreshSummaryChips === 'function') refreshSummaryChips(); // Ensure chips are in sync
  if (typeof updateDelayBtn === 'function') updateDelayBtn();
  if (typeof updateEndShiftVisibility === 'function') updateEndShiftVisibility();
  if (typeof updateCloseEarlyVisibility === 'function') updateCloseEarlyVisibility();
  if (typeof updateExitShiftVisibility === 'function') updateExitShiftVisibility();

  showToast('Order closed at ' + closeHHMM);

  // Reset progress header visuals ready for next order
  const pct  = document.getElementById('progPct');
  const fill = document.getElementById('progFill');
  if (pct)  pct.textContent = '0%';
  if (fill) fill.style.width = '0%';
  saveAll();
}

// Show/hide Delay button based on active shift
function updateDelayBtn(){
  const btn = document.getElementById('btnDelay');
  if (!btn) return;

  const shiftOn = !!startTime && window.archived !== true;
  btn.style.display = shiftOn ? 'inline-block' : 'none';
}

// Open delay modal, seeding readonly timestamp
function openDelayModal(){
    // Onboarding trigger — delay use
  Onboard.showHint("delay", "Use delays for congestion or stoppages. Timer runs until closed.");
  const shiftOn = !!startTime && window.archived !== true;
  if (!shiftOn) return alert('Start your shift to log notes/delays');

  delayDraft = { start: nowHHMM(), cause: '' };

  const s = document.getElementById('delayStart');
  const c = document.getElementById('delayCause');

  // display readonly timestamp instead of editable input
  if (s) s.textContent = delayDraft.start;
  if (c) c.value = '';

  document.getElementById('delayModal').style.display = 'flex';
}

function closeDelayModal(){ document.getElementById('delayModal').style.display='none'; }
function cancelDelay(){ delayDraft=null; closeDelayModal(); }

// Commit delay either to current order or shift-level log
function submitDelay(){
  if (!delayDraft){ closeDelayModal(); return; }

  const end = nowHHMM();
  const minutes = Math.max(1, Math.round((hm(end)-hm(delayDraft.start))*60));
  const cause = (document.getElementById('delayCause').value||'').trim();

  if (current && Number.isFinite(current.total)) {
    // attach to current order
    current.breaks = current.breaks || [];
    const entry = { type:'D', start: delayDraft.start, end, minutes, cause };
    current.breaks.push(entry);
    current.__lastDelay = entry;
    undoStack.push?.({ type:'delay' });
    renderTimeline?.(); updateSummary?.(); saveAll?.();
  } else {
    // shift-level delay (no active order)
    try {
      const key = 'shiftDelays';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      arr.push({ type:'D', start: delayDraft.start, end, minutes, cause });
      localStorage.setItem(key, JSON.stringify(arr));
    } catch(e){}
    renderShiftPanel?.();   // repaint Shift Log accordion
  }

  delayDraft = null;
  closeDelayModal();
  showToast('Delay logged (' + minutes + 'm)');
}

// ====== Shared Pick dock ======

// Update the shared dock label + button disabled state
// ====== Shared Pick dock ======

// Update the shared dock label + button disabled state
function updateSharedDockInfo() {
  const info = document.getElementById('sharedDockInfo');

  const total     = (current && current.total) ? +current.total : 0;
  const mySum     = Math.max(0, window.sharedMySum  || 0);  // my personal contributed units
  const block     = Math.max(0, window.sharedBlock  || 0);  // block logged in this session
  const remaining = Math.max(0, total - mySum);             // total left for *me*, not the team

  if (info) {
    if (current?.shared) info.textContent = `Current: ${block}`;
    else                 info.textContent = `Left: ${remaining}`;
  }

  const sBtn = document.getElementById('sharedSubmitBtn');
  if (sBtn) sBtn.disabled = remaining <= 0;
}

// Submit shared units (no pallet count, just overlay on the “left” number)
function sharedSubmitUnits(){
  const input = document.getElementById('sharedUnitsDock');
  const val   = parseInt(input?.value || '0', 10);
  if (!(val > 0)) return alert('Enter units first');

  if (!current || !current.total) return;
  if (!current.shared) current.shared = true;

  const total     = current.total || 0;
  const remaining = Math.max(0, total - (window.sharedMySum || 0));
  if (remaining === 0) {
    showToast?.('Target already reached.');
    input.value = '';
    return;
  }

  const add = Math.min(val, remaining);

  // Single source of truth for shared progress
  window.sharedMySum = (window.sharedMySum || 0) + add;
  window.sharedBlock = (window.sharedBlock || 0) + add;

  // Persist partial shared progress
  localStorage.setItem('sharedMySum', window.sharedMySum);
  localStorage.setItem('sharedBlock', window.sharedBlock);

  // Log entry for this shared session (for future analytics/replay)
  try {
    window.sharedSession?.entries?.push?.({ units: add, t: nowHHMM(), kind: 'submit' });
  } catch(e){}

  // --- compute new LEFT and reflect immediately ---
  const left = Math.max(0, total - (window.sharedMySum || 0));

  // Overlay so header mirrors shared progress (no fake pallet increment)
  window._sharedProgressLeft = left;

  // Jump the progress bar & % label right now
  const pct = total ? ((total - left) / total) * 100 : 0;
  try {
    setProgress?.(pct);
    const pctEl = document.getElementById('progPct');
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
  } catch(e){}

  // Update “Left” label under the bar
  try { updateLeftLabel?.(left); } catch(e){}

  // --- predictive: re-baseline without a blank frame ---
  try {
    // Kill any grace pause
    if (window._predictiveGraceTimer) {
      clearTimeout(window._predictiveGraceTimer);
      window._predictiveGraceTimer = null;
    }

    // Pick a sensible live rate fallback so ETA/Rate don't blank
    const effRate = Math.round(
      (typeof orderLiveRate === 'function' ? (orderLiveRate() || 0) : 0) ||
      (current && current.orderRateUh) ||
      (typeof getLiveRateUh === 'function' ? (getLiveRateUh() || 0) : 0) ||
      (predictive && predictive.rateUh) || 0
    );

    // Re-base to new left; keep previous rate if effRate is 0
    predictiveReset?.(left, effRate > 0 ? effRate : undefined);

    // Ensure predictive knows the rate immediately
    if (predictive) predictive.rateUh = (effRate > 0 ? effRate : (predictive.rateUh || 0));

    // Start (or restart) the timer and paint one frame now
    predictiveStart?.();
    predictiveTick?.();
  } catch(e){}

  // --- freeze OrderRate & ETA from this submission (static until next event) ---
  try {
    // Ground-truth snapshot = (units done so far) / (elapsed since order start)
    const doneNow    = Math.max(0, (total - left)); // units completed on this order
    const elapsedMin = Math.max(1, minutesBetween(current.start, nowHHMM())); // avoid ÷0
    const rateSnap   = Math.round(doneNow / (elapsedMin / 60)); // u/h

    // Set the order's static rate & keep predictive aligned
    current.orderRateUh = rateSnap > 0 ? rateSnap : 0;
    if (predictive) predictive.rateUh = current.orderRateUh || predictive.rateUh || 0;

    // Paint header rate & ETA from the static snapshot
    const useRate = current.orderRateUh || 0;
    if (useRate > 0) {
      const minsLeft = Math.round((left / useRate) * 60);
      const etaHHMM  = addMinutesToTime(nowHHMM(), minsLeft);
      const rEl = document.getElementById('progRate');
      const eEl = document.getElementById('progETA');
      if (rEl) rEl.textContent = `${useRate} u/h`;
      if (eEl) eEl.textContent = etaHHMM;
    } else {
      document.getElementById('progRate')?.replaceChildren(document.createTextNode('—'));
      document.getElementById('progETA') ?.replaceChildren(document.createTextNode('—'));
    }
    tintProgressByPace?.(useRate);
  } catch(e){}

  // Repaint header AFTER predictive tick so visuals align
  try { updateProgressHeader?.(); } catch(e){}

  // Elapsed snapshot on event (no ticking decay here)
  try { updateElapsedChip?.(); } catch(e){}

  // Refresh summary chips (Live Rate / Total Units) immediately
  try { updateSummary?.(); } catch(e){}

  // Bottom dock bits
  try { updateSharedDockInfo?.(); } catch(e){}

  input.value = '';
}

// Save a text note (no delay timing). Always goes into shift log,
// and if an order is active, we also mirror it into that order's log.
function submitNote(evt){
  try { evt?.preventDefault?.(); } catch(e){}

  const candidateIds = [
    'noteText',
    'noteTextArea',
    'delayNote',
    'delayCause'
  ];

  let el = null;
  for (const id of candidateIds) {
    const cand = document.getElementById(id);
    if (cand) { el = cand; break; }
  }

  if (!el) {
    console.warn('No note text area found for submitNote');
    return;
  }

  const raw = (el.value || '').trim();
  if (!raw) {
    if (typeof showToast === 'function') showToast('Type a note before saving');
    return;
  }

  const t    = nowHHMM();
  const cust = (current && current.name) ? current.name : null;

  // 1) Canonical shift-level log (always)
  try {
    const key = 'shiftNotes';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const payload = cust
      ? { t, note: raw, cust }
      : { t, note: raw };
    arr.push(payload);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    console.error('Failed to persist shift note', e);
  }

  // 2) If an order is active, mirror into that order's log
  if (current && Number.isFinite(current.total)) {
    current.breaks = current.breaks || [];
    current.breaks.push({
      type: 'N',
      t,
      note: raw
    });
    undoStack.push?.({ type: 'note' });
    try { renderTimeline?.(); } catch(e){}
    try { updateSummary?.(); } catch(e){}
    try { saveAll?.(); } catch(e){}
  }

  // 3) Refresh shift panel view
  try { renderShiftPanel?.(); } catch(e){}

  el.value = '';
  closeNoteModal?.();
  if (typeof showToast === 'function') showToast('Note logged');
}

// Entry-point from UI: just delegate to startBreak with kind 'B' / 'L'
function openBreakModal(kind){ startBreak(kind); }

// Start a break or lunch and show the top banner + chip
function startBreak(kind){
  var mins  = (kind==='B') ? 20 : 30;
  var start = nowHHMM();
  breakDraft = { type: kind, startHHMM: start, targetSec: mins*60, beeping: false };

  // Persist across refresh (so banner survives reload)
  try { localStorage.setItem('breakDraft', JSON.stringify(breakDraft)); } catch(e){}

  // Base bar text
  document.getElementById('breakBarTitle').textContent  = (kind==='B' ? 'Break' : 'Lunch');
  document.getElementById('breakBarStart').textContent  = start;

  // Target text is now optional – only set it if the span exists
  const targetSpan = document.getElementById('breakBarTarget');
  if (targetSpan) {
    targetSpan.textContent = mins + ' min target';
  }

  document.getElementById('breakBar').style.display = 'flex';

  // Paint a clean initial countdown & reset chip colours
  const countdown = document.getElementById('breakBarCountdown');
  if (countdown) countdown.textContent = mins + ' min';

  const chipBox = document.getElementById('chipElapsed');
  const chipVal = document.getElementById('chipElapsedVal');
  if (chipBox) {
    chipBox.style.display = '';
    chipBox.classList.remove('green', 'amber');  // clear previous state
  }
  if (chipVal) chipVal.textContent = mins + ' min';

  // First tick & 1s interval
  tickBreak();
  if (breakTickId) clearInterval(breakTickId);
  breakTickId = setInterval(tickBreak, 1000);

  // PREDICTIVE: pause creeping during breaks
  predictiveStop();
  if (typeof updateProgressHeader === 'function') updateProgressHeader();
}

// Tiny helper used elsewhere to check if an order is running
function hasActiveOrder(){
  return !!(window.current && Number.isFinite(window.current.total));
}

// Commit the break to the log and clean up banner/draft
function submitBreak(){
  if (!breakDraft) { return cancelBreak(); }

  const end = nowHHMM();
  const minutes = Math.max(1, Math.round((hm(end) - hm(breakDraft.startHHMM)) * 60));
  const entry = { type: breakDraft.type, start: breakDraft.startHHMM, end, minutes };
  if (!current) entry.noOrder = true;

  if (current) {
    current.breaks.push(entry);
    undoStack.push({ type:'break' });
    renderTimeline();
  } else {
    shiftBreaks.push(entry);
    try { renderTimeline?.(); } catch(e){}
    try { saveAll?.(); } catch(e){}
  }

  if (breakTickId) { clearInterval(breakTickId); breakTickId = null; }

  // Clear persisted draft
  try { localStorage.removeItem('breakDraft'); } catch (e) {}

  breakDraft = null;

  // If break started during operative mode, append a “Break/Lunch ended” note
  try {
    if (window._opWasRunningAtBreakStart) {
      const key = 'shiftNotes';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      const label = (entry.type === 'L') ? 'Lunch' : 'Break';
      arr.push({ t: end, note: `${label} ended`, op: true });
      localStorage.setItem(key, JSON.stringify(arr));
    }
  } catch(e){}
  // IMPORTANT: keep operative running — do NOT clear operative state here.

  const bar = document.getElementById('breakBar');
  if (bar) bar.style.display = 'none';

  // Reset countdown + chip so the next start is clean
  const countdown = document.getElementById('breakBarCountdown');
  if (countdown) countdown.textContent = '—';
  const chipBox = document.getElementById('chipElapsed');
  const chipVal  = document.getElementById('chipElapsedVal');
  if (chipBox) { chipBox.classList.remove('green','amber'); }
  if (chipVal)  { chipVal.textContent = '—'; }

  // Restore elapsed chip visibility/state depending on order context
  if (current) {
    if (chipBox) chipBox.style.display = '';
    updateElapsedChip();
  } else {
    if (chipBox) chipBox.style.display = 'none';
  }

  updateSummary();
  showToast('Break logged (' + minutes + 'm)');

  // --- CRITICAL FIX: Force remove the active_break tag from memory ---
  if (current && current.active_break) {
      delete current.active_break;
  }

  saveAll();
  renderShiftPanel?.();

  // PREDICTIVE: resume from current true left
  if (current) {
    predictiveReset(getCurrentLeft(), getLiveRateUh());
    predictiveStart();
  }

  // Tidy the flag after we've logged both notes
  window._opWasRunningAtBreakStart = false;
}

// Cancel an in-progress break timer without logging it
function cancelBreak(){
  if (breakTickId) { clearInterval(breakTickId); breakTickId = null; }

  // Clear persisted draft
  try { localStorage.removeItem('breakDraft'); } catch (e) {}

  breakDraft = null;

  const bar = document.getElementById('breakBar');
  if (bar) bar.style.display = 'none';

  // Reset countdown + chip so the next start is clean
  const countdown = document.getElementById('breakBarCountdown');
  if (countdown) countdown.textContent = '—';
  const chipBox = document.getElementById('chipElapsed');
  const chipVal  = document.getElementById('chipElapsedVal');
  if (chipBox) { chipBox.classList.remove('green','amber'); }
  if (chipVal)  { chipVal.textContent = '—'; }

  // Restore elapsed chip visibility/state depending on order context
  if (current) {
    if (chipBox) chipBox.style.display = '';
    updateElapsedChip();
  } else {
    if (chipBox) chipBox.style.display = 'none';
  }

  updateSummary();
  showToast('Break cancelled');
  saveAll();
  renderShiftPanel?.();

  // PREDICTIVE: resume from current true left
  if (current) {
    predictiveReset(getCurrentLeft(), getLiveRateUh());
    predictiveStart();
  }
}

// Tick the break timer (banner + chip) each second
function tickBreak() {
  if (!breakDraft) return;

  const now = nowHHMM();
  const elapsedMin = Math.round((hm(now) - hm(breakDraft.startHHMM)) * 60);
  const targetMin  = Math.round((breakDraft.targetSec || 0) / 60);
  const diff = targetMin - elapsedMin;

  const breakDisplay = diff >= 0 ? `${diff} min` : `-${Math.abs(diff)} min over`;

  const breakBar = document.getElementById('breakBarCountdown');
  const chip     = document.getElementById('chipElapsedVal');
  const chipBox  = document.getElementById('chipElapsed');

  const chipLabel = chipBox?.querySelector('b');
  if (chipLabel) chipLabel.textContent = 'Back in';

  if (breakBar) breakBar.textContent = breakDisplay;
  if (chip)     chip.textContent     = breakDisplay;

  if (chipBox) {
    chipBox.classList.remove('green', 'amber');
    chipBox.classList.add(diff >= 0 ? 'green' : 'amber');
  }
if (diff === 0 && !breakDraft.beeping) {
    breakDraft.beeping = true;
    tryBeep?.();
  }

  // Keep header ETA reflecting planned/overrun break in real time
  if (typeof updateProgressHeader === 'function') updateProgressHeader();
}

// ====== Completed orders & history timeline ======

function renderTimeline(){
  const tl = document.getElementById('orderTimeline');
  if (!tl) return;
  tl.innerHTML = '';

  // Tiny escaper (local to this function)
  const esc = s => String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');

  // Order start
  if (current) {
    const row0 = document.createElement('div');
    row0.className = 'tick';
    row0.innerHTML = `<span>🟢 Order started</span><span class="meta">${current.start || ''}</span>`;
    tl.appendChild(row0);
  }

  // Breaks / Delays / Notes (order-attached)
  (current?.breaks || []).forEach(b => {
    const row = document.createElement('div');
    row.className = 'tick';

    if (b.type === 'N') {
      const t   = b.t || '';
      const txt = (b.note || '').trim();
      row.innerHTML = `<span>📝 Note${txt ? ' — ' + esc(txt) : ''}</span><span class="meta">${t}</span>`;
    } else if (b.type === 'D') {
      const cause = b.cause ? ': ' + esc(b.cause) : '';
      const start = b.start || '';
      const end   = b.end   || '';
      const mins  = Number.isFinite(b.minutes) ? `${b.minutes}m` : '';
      const meta  = (start && end) ? `${start} → ${end}${mins ? ' • ' + mins : ''}` : (start || end || '');
      row.innerHTML = `<span>⏱️ Delay${cause}</span><span class="meta">${meta}</span>`;
    } else {
      const label = (b.type === 'B') ? 'Break' : 'Lunch';
      const start = b.start || '';
      const end   = b.end   || '';
      const mins  = Number.isFinite(b.minutes) ? `${b.minutes}m` : '';
      const meta  = (start && end) ? `${start} → ${end}${mins ? ' • ' + mins : ''}` : (start || end || '');
      row.innerHTML = `<span>☕ ${label}</span><span class="meta">${meta}</span>`;
    }

    tl.appendChild(row);
  });

  // Wraps (order-attached)
  tempWraps.forEach((w, i) => {
    const row = document.createElement('div');
    row.className = 'tick';
    row.innerHTML =
      `<span>📦 Wrap ${i+1}: <b>${w.done}</b> done, <b>${w.left}</b> left</span>` +
      `<span class="meta">${w.t || ''}</span>`;
    tl.appendChild(row);
  });

  // DESIGN: Operative events are intentionally NOT rendered here.
  // They appear only in Shift Log (see renderShiftPanel).

  // Shift-level items only when NO active order (kept as-is)
  if (!current) {
    let shiftNotes = [], shiftDelays = [];
    try { shiftNotes  = JSON.parse(localStorage.getItem('shiftNotes')  || '[]'); } catch(e){}
    try { shiftDelays = JSON.parse(localStorage.getItem('shiftDelays') || '[]'); } catch(e){}

    const items = [];

    (window.shiftBreaks || []).forEach(b => {
      items.push({
        kind:   (b.type === 'L') ? 'L' : 'B',
        start:  b.start || '',
        end:    b.end || '',
        minutes: Number.isFinite(b.minutes) ? b.minutes : undefined
      });
    });

    (shiftDelays || []).forEach(d => {
      items.push({
        kind:   'D',
        start:  d.start || '',
        end:    d.end || '',
        minutes: Number.isFinite(d.minutes) ? d.minutes : undefined,
        cause:  d.cause || ''
      });
    });

    (shiftNotes || []).forEach(n => {
      items.push({ kind: 'N', t: n.t || '', note: n.note || '' });
    });

    // Sort by time
    items.sort((a, b) => (a.t || a.start || '').localeCompare(b.t || b.start || ''));

    // Render shift-level ticks
    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'tick';
      if (it.kind === 'N') {
        const txt        = (it.note || '').trim();
        const custSuffix = it.cust ? ` (${esc(it.cust)})` : '';
        row.innerHTML =
          `<span>📝 Note${txt ? ' — ' + esc(txt) : ''}${custSuffix}</span>` +
          `<span class="meta">${it.t || ''}</span>`;
      } else if (it.kind === 'D') {
        const cause = it.cause ? ': ' + esc(it.cause) : '';
        const mins  = Number.isFinite(it.minutes) ? `${it.minutes}m` : '';
        const meta  = (it.start && it.end)
          ? `${it.start} → ${it.end}${mins ? ' • ' + mins : ''}`
          : (it.start || it.end || '');
        row.innerHTML =
          `<span>⏱️ Delay${cause}</span>` +
          `<span class="meta">${meta}</span>`;
      } else {
        const label = (it.kind === 'L') ? 'Lunch' : 'Break';
        const mins  = Number.isFinite(it.minutes) ? `${it.minutes}m` : '';
        const meta  = (it.start && it.end)
          ? `${it.start} → ${it.end}${mins ? ' • ' + mins : ''}`
          : (it.start || it.end || '');
        row.innerHTML =
          `<span>☕ ${label}</span>` +
          `<span class="meta">${meta}</span>`;
      }
      tl.appendChild(row);
    });
  }
}
// ====== Shift Log panel (live + archived shift-level events) ======
function renderShiftPanel(){
  const card = document.getElementById('shiftLogCard');
  const list = document.getElementById('shiftLogList');
  if (!card || !list) return;

  // Tiny HTML escaper for note text / causes
  const esc = s => String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');

  const rows = [];

  // Live indicators (status rows at the top)
  if (operativeActive && !operativeActive.end){
    rows.push(
      `<div class="tick"><span>🟢 Operative running</span><span class="meta">since ${operativeActive.start || '--:--'}</span></div>`
    );
  }
  if (!current && breakDraft){
    const kind  = breakDraft.type === 'L' ? 'Lunch' : 'Break';
    rows.push(
      `<div class="tick"><span>🟡 ${kind} in progress</span><span class="meta">since ${breakDraft.startHHMM || '--:--'}</span></div>`
    );
  }

  // Collect completed shift-level items (RAM + localStorage)
  const items = [];

  // NOTE: Finished OP range rows are NOT rendered here; we use OS/OE markers instead.

  // Finished breaks/lunches (session RAM)
  (Array.isArray(shiftBreaks) ? shiftBreaks : []).forEach(br=>{
    if (br && br.end){
      items.push({
        kind:    (br.type==='L' ? 'L' : 'B'),
        start:   br.start || '',
        end:     br.end   || '',
        minutes: Number.isFinite(br.minutes) ? br.minutes : undefined
      });
    }
  });

  // Persisted delays / notes
  let shiftDelays = [], shiftNotes = [];
  try { shiftDelays = JSON.parse(localStorage.getItem('shiftDelays') || '[]'); } catch(e){}
  try { shiftNotes  = JSON.parse(localStorage.getItem('shiftNotes')  || '[]'); } catch(e){}

  shiftDelays.forEach(d=>{
    items.push({
      kind:    'D',
      start:   d.start || '',
      end:     d.end   || '',
      minutes: Number.isFinite(d.minutes) ? d.minutes : undefined,
      cause:   d.cause || '',
      cust:    d.cust || null      // 👈 customer tag (if present)
    });
  });

  // Normalize notes: special-case operative markers vs normal notes
  (Array.isArray(shiftNotes) ? shiftNotes : []).forEach(n=>{
    const t       = n.t || '';
    const noteTxt = (n.note || '').trim();

    if (n.op && /^Operative started/i.test(noteTxt)) {
      items.push({ kind:'OS', t, text: noteTxt }); // Operative Start marker
    } else if (n.op && /^Operative ended/i.test(noteTxt)) {
      items.push({ kind:'OE', t, text: noteTxt }); // Operative End marker
    } else if (n.op && /(Break|Lunch)\s+(started|ended)/i.test(noteTxt)) {
      items.push({ kind:'OBN', t, text: noteTxt }); // Operative-scoped break/lunch markers
    } else {
      items.push({
        kind: 'N',
        t,
        note: noteTxt,
        op: !!n.op,
        cust: n.cust || null  // 👈 optional customer tag
      }); // Regular / operative note
    }
  });

  // Deduplicate by a stable key so reloads don't spam duplicates
  const seen  = new Set();
  const dedup = [];
  for (const it of items){
    const key =
      (it.kind === 'N')                 ? `N@${it.t}@${it.note}@${it.cust || ''}` :
      (it.kind === 'D')                 ? `D@${it.start}@${it.end}@${it.cause}@${it.cust || ''}` :
      (it.kind === 'B' || it.kind==='L') ? `${it.kind}@${it.start}@${it.end}` :
                                           `${it.kind}@${it.t || it.start || ''}`;
    if (!seen.has(key)){
      seen.add(key);
      dedup.push(it);
    }
  }

  // Chronological (by time / start)
  dedup.sort((a,b)=>{
    const ta = a.t || a.start || '';
    const tb = b.t || b.start || '';
    return ta.localeCompare(tb);
  });

  // Render all rows
  const out = [...rows];
  dedup.forEach(it=>{
    if (it.kind === 'B' || it.kind === 'L'){
      const label = it.kind === 'L' ? 'Lunch' : 'Break';
      const mins  = it.minutes != null ? ` • ${it.minutes}m` : '';
      out.push(
        `<div class="tick"><span>☕ ${label}</span>` +
        `<span class="meta">${it.start} → ${it.end}${mins}</span></div>`
      );
    } else if (it.kind === 'D'){
      const mins       = it.minutes != null ? ` • ${it.minutes}m` : '';
      const cause      = it.cause ? `: ${esc(it.cause)}` : '';
      const custSuffix = it.cust ? ` (${esc(it.cust)})` : '';
      const meta       = (it.start && it.end)
        ? `${it.start} → ${it.end}${mins}`
        : (it.start || it.end || '');
      out.push(
        `<div class="tick"><span>⏱️ Delay${cause}${custSuffix}</span>` +
        `<span class="meta">${meta}</span></div>`
      );
    } else if (it.kind === 'OS'){
      out.push(
        `<div class="tick"><span>🟠 Operative started</span>` +
        `<span class="meta">${it.t}</span></div>`
      );
    } else if (it.kind === 'OE'){
      // tail e.g. "— 21m" if present
      const tail = it.text.replace(/^Operative ended\s*/i,'').trim();
      const meta = tail ? `${it.t} ${esc(tail)}` : it.t;
      out.push(
        `<div class="tick"><span>🔴 Operative ended</span>` +
        `<span class="meta">${meta}</span></div>`
      );
    } else if (it.kind === 'OBN'){
      out.push(
        `<div class="tick"><span>☕ ${esc(it.text)} (operative)</span>` +
        `<span class="meta">${it.t}</span></div>`
      );
    } else if (it.kind === 'N'){
      const opSuffix   = it.op ? ' (operative)' : '';
      const txt        = (it.note || '').trim();
      const custSuffix = it.cust ? ` (${esc(it.cust)})` : '';
      out.push(
        `<div class="tick"><span>📝 Note${opSuffix}${txt ? ' — ' + esc(txt) : ''}${custSuffix}</span>` +
        `<span class="meta">${it.t}</span></div>`
      );
    }
  });

  // If nothing to show yet, hide the Shift Log card completely
  if (!out.length) {
    list.innerHTML = '';
    card.style.display = 'none';
  } else {
    list.innerHTML = out.join('');
    card.style.display = 'block';
  }

  applyProGate?.();

  // Let the normal button updaters decide visibility instead of force-hiding.
  if (typeof updateDelayBtn === 'function') updateDelayBtn();
  if (typeof updateCloseEarlyVisibility === 'function') updateCloseEarlyVisibility();
}


// --- Close Early buttons visibility (tracker tab only)
function updateCloseEarlyVisibility(){
  const btn = document.getElementById('btnCloseEarly');
  if (!btn) return;

  const on = !!(current && Number.isFinite(current.total));
  btn.style.display = on ? 'inline-block' : 'none';
  btn.disabled = !on;
}

// --- Close Early modal open/close
function openCloseEarlyModal(){
  if (!current) return;

  const r = document.getElementById('ceReason');
  const rem = document.getElementById('ceRemaining');
  const wrappedChk = document.getElementById('ceWrapped');

  if (rem) rem.value = '';
  if (wrappedChk) wrappedChk.checked = false;
  if (r) r.value = '';

  const m = document.getElementById('closeEarlyModal');
  if (m) m.style.display = 'flex';
}

function closeCloseEarlyModal(){
  const m = document.getElementById('closeEarlyModal');
  if (m) m.style.display = 'none';
}

// --- Finalize Close Early (archive partial order with reason)
function submitCloseEarly(){
  if (!current) return closeCloseEarlyModal?.();

  // 1) read + validate remaining
  const remEl = document.getElementById('ceRemaining');
  const remaining = parseInt((remEl?.value || '0'), 10);
  if (!Number.isFinite(remaining) || remaining < 0) {
    return alert('Enter remaining units (0 or more).');
  }

  const prevLeft = tempWraps.length
    ? tempWraps[tempWraps.length - 1].left
    : (current.total || 0);

  if (remaining > prevLeft) {
    return alert(`Remaining cannot exceed current left (${prevLeft}).`);
  }

  const wrapped  = !!document.getElementById('ceWrapped')?.checked;
  const reasonEl = document.getElementById('ceReason');
  const reason   = (reasonEl && reasonEl.value || '').trim();

  // reason only required when closing with units left
  if (remaining > 0 && reason.length < 3) {
    if (reasonEl) reasonEl.focus();
    return alert('Please add a short reason for closing early.');
  }

  // 2) optional final wrap (only if we actually reduced left)
  let addedWrap = false;
  if (wrapped) {
    if (remaining < prevLeft) {
      // Track wrap timing for close early scenario
      const endTs = Date.now();
      let wrapDurationMs = 0;
      let wrapStartTime = null;
      
      if (current.wrapActive) {
        wrapStartTime = current.wrapActive.startTime;
        const startTs = current.wrapActive.startTs || endTs;
        wrapDurationMs = Math.max(0, endTs - startTs);
      }
      
      tempWraps.push({ 
        left: remaining, 
        done: prevLeft - remaining, 
        t: nowHHMM(),
        startTime: wrapStartTime,
        endTime: nowHHMM(),
        durationMs: wrapDurationMs
      });
      addedWrap = true;
    } else {
      return alert('No progress since last wrap. Uncheck “Wrapped last pallet” or adjust Remaining.');
    }
  }

  // 3) confirm (if helper exists) then archive
  const closeHHMM  = nowHHMM();
  const unitsDone  = (current.total || 0) - remaining;
  const palletsCnt = tempWraps.length || 1;

  const ok = (typeof confirmCloseSummary === 'function')
    ? confirmCloseSummary({
        name: current.name,
        unitsDone,
        pallets: palletsCnt,
        start: current.start,
        close: closeHHMM,
        remaining,
        earlyReason: reason
      })
    : true;

  if (ok === false) {
    if (addedWrap) tempWraps.pop();
    return;
  }

  const exclMins = (current.breaks || [])
    .reduce((a,b)=> a + (b.minutes || 0), 0);

  const archivedEarly = {
    name:        current.name,
    units:       unitsDone,
    pallets:     palletsCnt,
    start:       current.start,
    close:       closeHHMM,
    remaining,
    excl:        exclMins,
    earlyReason: reason || '',
    closedEarly: true,
    log: {
      wraps:  tempWraps.slice(0),
      breaks: (current.breaks || []).slice(0)
    }
  };

  picks.push(archivedEarly);
  lastClose = closeHHMM;

  // NEW: sync Close-Early orders too (keeps DB in line with UI)
  try {
    syncClosedOrderToBackend(archivedEarly);
  } catch (e) {
    console.warn('[WQT] failed to sync early-closed order', e);
  }


  // 4) reset state + UI (bring back new-order header form)
  predictiveStop?.();
  current   = null;
  tempWraps = [];
  undoStack = [];

  // hide active area
  const area = document.getElementById('orderArea');
  if (area) area.style.display = 'none';

  // swap progress header -> header form
  const hdrForm = document.getElementById('orderHeaderForm');
  const hdrProg = document.getElementById('orderHeaderProgress');
  if (hdrForm && hdrProg) {
    if (typeof fadeSwap === 'function') {
      fadeSwap(hdrProg, hdrForm, 'block');
    } else {
      hdrProg.style.display = 'none';
      hdrForm.style.display = 'block';
    }
  }

  // reset inputs for a fresh order (use helper if present)
  if (typeof resetNewOrderForm === 'function') {
    resetNewOrderForm();
  } else {
    const oLeft  = document.getElementById('oLeft');   if (oLeft)  oLeft.value  = '';
    const oTotal = document.getElementById('oTotal');  if (oTotal) oTotal.value = '';
    const sel    = document.getElementById('oCust');   if (sel)    sel.value    = '';
    const ddT    = document.querySelector('#oDD .dd-toggle');
    if (ddT) ddT.textContent = 'Select customer…';
  }

  // buttons/chips
  const btnUndo     = document.getElementById('btnUndo');
  const btnStartTop = document.getElementById('btnStart');
  const btnComplete = document.getElementById('btnComplete');
  const chipBox     = document.getElementById('chipElapsed');

  if (btnUndo)     btnUndo.style.display = 'none';
  if (btnStartTop) { btnStartTop.style.display = 'inline-block'; btnStartTop.disabled = true; }
  if (btnComplete) btnComplete.style.display = 'none';
  if (chipBox)     chipBox.style.display = 'none';

  // close modal + refresh everything
  closeCloseEarlyModal?.();
  renderDone?.();
  updateSummary?.();
  updateDelayBtn?.();
  updateEndShiftVisibility?.();
  updateCloseEarlyVisibility?.();
  saveAll?.();
  showToast?.('Order closed');

  // keep action row grouped
  ensureActionRowLayout?.();
}

// ====== Completed Orders table (live day) ======
function renderDone(){
  var tb = document.getElementById('doneBody');
  if (!tb) return;
  tb.innerHTML = '';

  picks.forEach(function(o,i){
    var s = hm(o.start), e = hm(o.close);
    
    // Calculate total break time
    var excl = (o.log && Array.isArray(o.log.breaks))
      ? o.log.breaks.reduce((a,b)=>a+(b.minutes||0),0)
      : (o.excl || 0);
    
    // Calculate total wrap downtime (in minutes)
    var wrapMins = 0;
    if (o.log && Array.isArray(o.log.wraps)) {
      wrapMins = o.log.wraps.reduce((acc, w) => {
        const durationMs = w.durationMs || 0;
        return acc + (durationMs / 60000);
      }, 0);
    }
    
    // Net active hours: exclude both breaks AND wrap downtime
    var net  = (e > s) ? (e - s) - (excl + wrapMins)/60 : 0.01;
    var rate = Math.round(o.units / Math.max(0.01, net));

    // Calculate per-order Perf Rate using ACTIVE time (same as Order Rate)
    var perfRate = '—';
    if (Number.isFinite(o.perfPerHour)) {
      perfRate = Math.round(o.perfPerHour) + ' pts/h';
    } else if (net > 0) {
      // Use net hours (active time excluding breaks) instead of raw elapsed time
      const units = o.units ?? o.totalUnits ?? o.qty ?? 0;
      const locations = o.locations ?? o.totalLocations ?? 0;
      const orderScore = units + (locations * 2);
      const perfRateVal = orderScore / net;  // pts/h using active hours
      perfRate = Math.round(perfRateVal) + ' pts/h';
    }

    // Main row - only 7 columns now
    var tr = document.createElement('tr');
    tr.className = 'completed-row';
    tr.dataset.index = i;
    tr.innerHTML =
      '<td>'+(i+1)+'</td>'+
      '<td>'+ (o.name || '') +'</td>'+
      '<td>'+ (o.units || 0) +'</td>'+
      '<td>'+ (o.locations || 0) +'</td>'+
      '<td>'+ (o.pallets || 0) +'</td>'+
      '<td>'+rate+' u/h</td>'+
      '<td>'+perfRate+'</td>';
    tb.appendChild(tr);

    // Expandable order log row
    var logTr = document.createElement('tr');
    logTr.className = 'order-log-row';
    logTr.dataset.index = i;

    var logTd = document.createElement('td');
    logTd.colSpan = 7;

    // Build order log table
    var html = '<div class="order-log-container">';
    html += '<div class="order-log-header">Order log</div>';
    html += '<table class="order-log-table">';
    html += '<thead><tr><th>Event</th><th>Details</th><th>Time</th></tr></thead>';
    html += '<tbody>';

    // Order summary info
    html += '<tr><td>📊 Summary</td><td>Units: '+(o.units||0)+', Locs: '+(o.locations||0)+', Pallets: '+(o.pallets||0)+'</td><td></td></tr>';

    // Order started
    if (o.start) {
      html += '<tr><td>Order started</td><td></td><td>'+o.start+'</td></tr>';
    }

    // Wraps
    (o.log?.wraps || []).forEach(function(w,wi){
      var timeStr = w.t || '—';
      var details = (wi+1).toString();
      
      // If we have start and end times, show range
      if (w.startTime && w.endTime) {
        timeStr = w.startTime + ' → ' + w.endTime;
        
        // Add duration if available
        if (w.durationMs) {
          var durationMin = Math.round(w.durationMs / 60000);
          details += ' (' + durationMin + 'm)';
        }
      }
      
      html += '<tr><td>📦 Wrap</td><td>'+details+'</td><td>'+timeStr+'</td></tr>';
    });

    // Breaks/Delays (optional detail)
    (o.log?.breaks || []).forEach(function(b){
      if (b.type === 'D'){
        var cause = b.cause ? b.cause.replace(/</g,'&lt;') : '';
        html += '<tr><td>⏱️ Delay</td><td>'+cause+'</td><td>'+b.start+' → '+b.end+'</td></tr>';
      } else {
        var label = b.type === 'B' ? '☕ Break' : '🍴 Lunch';
        html += '<tr><td>'+label+'</td><td></td><td>'+b.start+' → '+b.end+'</td></tr>';
      }
    });

    // Order ended
    if (o.close) {
      html += '<tr><td>Order ended</td><td></td><td>'+o.close+'</td></tr>';
    }

    // Early close reason if applicable
    if (o.earlyReason && o.earlyReason.trim().length > 0) {
      html += '<tr><td>📝 Early close</td><td>'+o.earlyReason.replace(/</g,'&lt;')+'</td><td></td></tr>';
    }

    html += '</tbody></table></div>';
    

    logTd.innerHTML = html;
    logTr.appendChild(logTd);
    tb.appendChild(logTr);
  });

  // Remove old click handlers and add new one to toggle order logs
  const newTb = tb.cloneNode(true);
  tb.parentNode.replaceChild(newTb, tb);
  
  newTb.addEventListener('click', function(e){
    const row = e.target.closest('.completed-row');
    if (!row) return;
    const idx = row.dataset.index;
    const detail = newTb.querySelector(`.order-log-row[data-index="${idx}"]`);
    if (!detail) return;
    detail.classList.toggle('is-open');
  });

  const completedCard = document.getElementById('completedCard');
  if (completedCard) {
    completedCard.style.display = picks.length ? 'block' : 'none';
  }
}

// ====== Weekly summary tiles (based on historyDays) ======
function renderWeeklySummary(){
  const todayISO = (new Date()).toISOString().slice(0,10);
  const { startISO, endISO, startDate, endDate } = weekBoundsFor(todayISO);

  const QUARTER = 15;
  const WEEK_OT_THRESHOLD_MIN = 45 * 60; // paid OT only after 45h worked in week
  const floorToQuarter = (mins) => Math.max(0, Math.floor(mins / QUARTER) * QUARTER);

  let totalUnits = 0;
  let totalLocations = 0;
  let totalWorkedFlooredMin = 0;  // all worked time, floored to 15m
  let daysCount  = 0;
  let dailyPerfSum = 0;  // sum of dailyPerf for averaging
  let dailyPerfCount = 0;  // count of days with valid dailyPerf

  for (const d of historyDays) {
    if (!inRange(d.date, startISO, endISO)) continue;

    const toMin = (hhmm) => {
      const [H,M] = (hhmm || '00:00').split(':').map(x => parseInt(x,10) || 0);
      return H * 60 + M;
    };

    // Actual worked minutes to the minute
    const workedMinRaw =
      Number.isFinite(+d.workedMin) ? +d.workedMin
      : (d.start && d.end) ? Math.max(0, toMin(d.end) - toMin(d.start))
      : 0;

    const workedMinFloored = floorToQuarter(workedMinRaw);

    totalWorkedFlooredMin += workedMinFloored;
    totalUnits += Number(d.totalUnits) || 0;
    totalLocations += Number(d.totalLocations) || 0;
    daysCount  += 1;

    // Accumulate dailyPerf for weekly average
    if (Number.isFinite(d.dailyPerf) && d.dailyPerf > 0) {
      dailyPerfSum += d.dailyPerf;
      dailyPerfCount += 1;
    }
  }

  // Weekly split: only minutes beyond 45h count as 'paid overtime'
  const paidOTMin = Math.max(0, totalWorkedFlooredMin - WEEK_OT_THRESHOLD_MIN);
  const nonOTMin  = totalWorkedFlooredMin - paidOTMin;

  // Tiles - using correct scoring: units + 2*locations
  const totalHoursAll   = totalWorkedFlooredMin / 60;        // for weighted avg denominator
  const totalHoursTile  = (nonOTMin / 60).toFixed(2);        // non-OT hours only
  const overtimeTile    = (paidOTMin / 60).toFixed(2) + ' h';// paid OT only
  const totalScore      = totalUnits + (totalLocations * 2);
  const weighted        = (totalHoursAll > 0) ? Math.round(totalScore / totalHoursAll) : 0;

  // weeklyPerf: average of dailyPerf values
  const weeklyPerf = (dailyPerfCount > 0) ? Math.round((dailyPerfSum / dailyPerfCount) * 10) / 10 : 0;

  document.getElementById('weekUnits')    ?.replaceChildren(document.createTextNode(String(totalUnits)));
  document.getElementById('weekDays')     ?.replaceChildren(document.createTextNode(String(daysCount)));
  document.getElementById('weekHours')    ?.replaceChildren(document.createTextNode(totalHoursTile));
  document.getElementById('weekOvertime') ?.replaceChildren(document.createTextNode(overtimeTile));
  document.getElementById('weekWeighted') ?.replaceChildren(document.createTextNode(weighted + ' pts/h'));
  
  // Add weeklyPerf display
  const weeklyPerfEl = document.getElementById('weeklyPerf');
  if (weeklyPerfEl) {
    weeklyPerfEl.replaceChildren(document.createTextNode(weeklyPerf > 0 ? weeklyPerf.toFixed(1) + ' pts/h' : '—'));
  }

  // Optional styling: OT red until threshold crossed, then green
  const otEl = document.getElementById('weekOvertime');
  if (otEl) {
    otEl.classList.remove('green','red');
    otEl.classList.add(paidOTMin > 0 ? 'green' : 'red');
  }

  // Week range hint
  const hint = document.getElementById('weekRangeHint');
  if (hint) {
    hint.textContent = `Week: ${startDate.toDateString().slice(0,10)} → ${endDate.toDateString().slice(0,10)}`;
  }
}

// ====== History render (per-day accordions) ======
function renderHistory(){
  var host = document.getElementById('histList');
  if (!host) return;
  host.innerHTML = '';

  if (!historyDays.length){
    host.innerHTML = '<div class="hint">No archived days yet.</div>';
    renderWeeklySummary();
    return;
  }

  var days = historyDays.slice(0).reverse();
  days.forEach(function(d,diRev){
    const di = historyDays.length - 1 - diRev;
    var head = document.createElement('div'); // class set after we know worked-hours avg

    const leftDiv = document.createElement('div');
    leftDiv.className = 'left';

    const num   = (v)=> Number.isFinite(+v) ? +v : 0;
    const toMin = (hhmm)=> Math.round(hm(hhmm) * 60);

    const workedMin    = num(d.workedMin)    ||
      ((d.start && d.end) ? Math.max(0, toMin(d.end) - toMin(d.start)) : 0);
    const scheduledMin = num(d.scheduledMin) ||
      Math.round((num(d.shiftLen) || 9) * 60);

    const floorToQuarter = (mins)=> Math.max(0, Math.floor(mins/15)*15);
    const otMin = floorToQuarter(Math.max(0, workedMin - scheduledMin));

    // Day Perf Score based on ACTUAL worked hours: (units + 2*locations) / worked_hours
    const workedHours   = workedMin / 60;
    const dayPerfScore = (workedHours > 0)
      ? Math.round(((Number(d.totalUnits) || 0) + (Number(d.totalLocations) || 0) * 2) / workedHours * 10) / 10
      : 0;
    const effectiveRate = (Number.isFinite(+d.dayPerfScore) && +d.dayPerfScore > 0)
      ? +d.dayPerfScore
      : dayPerfScore;

    // Pick Rate: total units / (shift hours - 1 hour break), clamped to min 0.1 hours
    const shiftHours = ((d.start && d.end) ? (toMin(d.end) - toMin(d.start)) / 60 : (num(d.shiftLen) || 9));
    const pickRateHours = Math.max(0.1, shiftHours - 1);  // Subtract 1 hour for break, min 0.1
    const pickRate = Math.round((d.totalUnits || 0) / pickRateHours);

    // Daily Perf: average of perfPerHour from orders (if available)
    const dailyPerf = Number.isFinite(d.dailyPerf) && d.dailyPerf > 0 ? d.dailyPerf : 0;

    const boxState = effectiveRate >= 300 ? 'ok'
                    : (effectiveRate >= 249 ? 'warn' : 'bad');
    head.className = 'accHead ' + boxState;

    // Header layout: date + meta row
    leftDiv.innerHTML =
      `<span class="tag">${new Date(d.date+'T12:00:00').toDateString().slice(0,15)}</span>
      <div class="meta-row">
        <span>Units: <b>${d.totalUnits || 0}</b></span>
        <span>Locations: <b>${d.totalLocations || 0}</b></span>
        <span>Pick Rate: <b>${pickRate}</b> u/h</span>
        ${dailyPerf > 0 ? `<span>Daily Perf: <b>${dailyPerf.toFixed(1)}</b> pts/h</span>` : ''}
        <span>Worked: <b>${fmtElapsed(workedMin)}</b>` +
        `${otMin ? ` • OT: <b>${(otMin/60).toFixed(2)} h</b>` : ''}</span>
      </div>`;
    head.appendChild(leftDiv);

    // Per-day delete button (gated by delete-mode)
    const del = document.createElement('button');
    del.textContent = '✖';
    del.className = 'btn slim ghost gate-pro';
    del.title = 'Delete day';

    // Honor delete-mode & neutralize the gate-pro hider
    if (window._histDeleteMode) {
      del.style.display = 'inline-block';
      del.classList.remove('gate-pro');
    } else {
      del.style.display = 'none';
      if (!del.classList.contains('gate-pro')) del.classList.add('gate-pro');
    }

    del.onclick = (e)=>{
      e.stopPropagation();
      if (!confirm('Delete this archived day? This cannot be undone.')) return;
      historyDays.splice(di,1);
      saveAll();
      renderHistory();
      showToast('Day deleted');
    };
    head.appendChild(del);

    // Chevron (expand/collapse)
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▾';
    head.appendChild(chev);

    var body = document.createElement('div');
    body.className = 'accBody';

    // Per-day orders table
    var table = document.createElement('table');
    table.innerHTML =
      '<thead><tr><th>#</th><th>Customer</th><th>Units</th><th>Pallets</th><th>Start</th><th>Closed</th><th>Active Min</th><th>Perf/h</th></tr></thead>';
    var tbody = document.createElement('tbody');

    (d.picks || []).forEach(function(o,i){
      var s = hm(o.start), e = hm(o.close);
      var excl = (o.log && Array.isArray(o.log.breaks))
        ? o.log.breaks.reduce((a,b)=>a+(b.minutes||0),0)
        : (o.excl || 0);
      var net  = (e > s) ? (e - s) - (excl)/60 : 0.01;
      var rate = Math.round(o.units / Math.max(0.01, net));

      // Get new metrics if available
      const activeMin = Number.isFinite(o.activeMinutes) ? o.activeMinutes : Math.round(net * 60);
      const perfPerHour = Number.isFinite(o.perfPerHour) ? o.perfPerHour.toFixed(1) : '—';

      var tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.dataset.idx = i;
      tr.innerHTML =
        '<td>'+(i+1)+'</td>'+
        '<td>'+ (o.name || '') +'</td>'+
        '<td>Units: <b>' + (o.units || 0) + '</b>' + (o.locations ? ' • Locations: <b>'+ (o.locations || 0) + '</b>' : '') + '</td>'+
        '<td>'+ (o.pallets || 0) +'</td>'+
        '<td>'+ (o.start || '') +'</td>'+
        '<td>'+ (o.close || '') +'</td>'+
        '<td>'+ activeMin +' min</td>'+
        '<td>'+ perfPerHour +'</td>';

      var logTr = document.createElement('tr');
      logTr.className = 'logrow';
      logTr.id = 'hlog_'+di+'_'+i;

      var td = document.createElement('td');
      td.colSpan = 8;

      var html = '<div class="logwrap"><div class="hint">Order log</div>';
      (o.log?.breaks || []).forEach(function(b){
        if (b.type === 'D'){
          html += '<div class="tick"><span>⏱️ Delay' +
            (b.cause ? ': '+b.cause.replace(/</g,'&lt;') : '') +
            '</span><span class="meta">'+b.start+' → '+b.end+' • '+b.minutes+'m</span></div>';
        } else {
          html += '<div class="tick"><span>☕ '+(b.type==='B'?'Break':'Lunch')+
            '</span><span class="meta">'+b.start+' → '+b.end+' • '+b.minutes+'m</span></div>';
        }
      });
      (o.log?.wraps || []).forEach(function(w,wi){
        html += '<div class="tick"><span>📦 Wrap '+(wi+1)+': <b>'+w.done+
          '</b> done, <b>'+w.left+'</b> left</span><span class="meta">'+w.t+'</span></div>';
      });
      html += '</div>';

      td.innerHTML = html;
      logTr.appendChild(td);

      tbody.appendChild(tr);
      tbody.appendChild(logTr);

      tr.addEventListener('click', function(){
        var row = document.getElementById('hlog_'+di+'_'+i);
        if (!row) return;
        row.style.display = (row.style.display === 'table-row') ? 'none' : 'table-row';
      });
    });

    table.appendChild(tbody);
    body.appendChild(table);

    // Nested accordion: notes & downtime for the day
    const subAcc  = document.createElement('div'); subAcc.className  = 'accordion';
    const subHead = document.createElement('div'); subHead.className = 'accHead';
    subHead.innerHTML = '<div class="left"><span>Notes & Downtime</span></div><span class="chev">▾</span>';
    const subBody = document.createElement('div'); subBody.className = 'accBody';

    const notes = document.createElement('div');
    notes.className = 'logwrap';
    let notesHtml = '<div class="hint">Notes</div>';

    (d.shiftBreaks || []).forEach(b=>{
      notesHtml += `<div class="tick"><span>☕ ${(b.type==='B')?'Break':'Lunch'}</span>`+
                   `<span class="meta">${b.start} → ${b.end} • ${b.minutes}m</span></div>`;
    });

    (d.picks || []).forEach(o=>{
      (o.log?.breaks || []).forEach(b=>{
        if (b.type === 'B' || b.type === 'L'){
          notesHtml += `<div class="tick"><span>☕ ${(b.type==='B')?'Break':'Lunch'} (${o.name})</span>`+
                       `<span class="meta">${b.start} → ${b.end} • ${b.minutes}m</span></div>`;
        } else if (b.type === 'D'){
          notesHtml += `<div class="tick"><span>⏱️ Delay${b.cause?': '+b.cause.replace(/</g,'&lt;'):''} (${o.name})</span>`+
                       `<span class="meta">${b.start} → ${b.end} • ${b.minutes}m</span></div>`;
        }
      });
    });

    (d.downtimes || []).forEach(g=>{
      notesHtml += `<div class="tick"><span>⏳ Downtime</span>`+
                   `<span class="meta">${g.from} → ${g.to} • ${g.minutes}m</span></div>`;
    });

    notes.innerHTML = notesHtml;
    subBody.appendChild(notes);

    subAcc.appendChild(subHead);
    subAcc.appendChild(subBody);
    body.appendChild(subAcc);

    var wrap = document.createElement('div');
    wrap.className = 'accordion';
    wrap.appendChild(head);
    wrap.appendChild(body);
    host.appendChild(wrap);

    // Toggles
    head.addEventListener('click', function(){
      var open = body.style.display === 'block';
      body.style.display = open ? 'none' : 'block';
      const c = head.querySelector('.chev');
      if (c) c.textContent = open ? '▾' : '▴';
    });
    subHead.addEventListener('click', function(){
      var open = subBody.style.display === 'block';
      subBody.style.display = open ? 'none' : 'block';
      const c = subHead.querySelector('.chev');
      if (c) c.textContent = open ? '▾' : '▴';
    });
  });

  applyProGate?.();

  // Force-hide controls when no active shift/order on History tab
  const delayBtn = document.getElementById('btnDelay');
  const closeBtn = document.getElementById('btnCloseEarly');
  if (delayBtn) delayBtn.style.display = 'none';
  if (closeBtn) closeBtn.style.display = 'none';
}

// ====== End Shift button visibility (History tab) ======
function updateEndShiftVisibility(){
  const btn = document.getElementById('btnEndShift');
  if (!btn) return;
  btn.style.display = 'inline-block';
}
// ====== Exit Shift button visibility (History tab; no-archive path) ======
function updateExitShiftVisibility(){
  const btn = document.getElementById('btnExitShift');
  if (!btn) return;

  const histTab = document.getElementById('tabHistory');
  const historyVisible = histTab ? !histTab.classList.contains('hidden') : false;

  // "Active shift" if we either have a start time or the durable flag is on
  const hasShiftFlag = !!startTime || localStorage.getItem('shiftActive') === '1';

  // Only allow Exit Shift when there are no completed orders to archive
  const hasOrders = Array.isArray(picks) && picks.length > 0;

  const show = historyVisible && hasShiftFlag && !hasOrders;
  btn.style.display = show ? 'inline-block' : 'none';
}
function updateEndPickingVisibility(){
  const btn = document.getElementById('btnEndPicking');
  if (!btn) return;
  // Show only when History tab is visible (button moved there)
  const histTab = document.getElementById('tabHistory');
  const historyVisible = histTab ? !histTab.classList.contains('hidden') : false;

  const hasShift = !!startTime;
  const inOrder  = !!(current && Number.isFinite(current.total));
  const frozen   = !!pickingCutoff;

  // Time gate: only show after a certain clock time (e.g. 15:00)
  let lateEnough = true;
  try {
    const nowHH   = nowHHMM();      // "HH:MM"
    const nowVal  = hm(nowHH);      // decimal hours
    const gateVal = hm('15:00');    // change to '14:30' if you want earlier
    lateEnough    = nowVal >= gateVal;
  } catch (e) {
    // If anything fails, fail open so the button can still appear
    lateEnough = true;
  }

  // Only show between orders, during an active shift, after gate time, before we’ve frozen picking
  const show = historyVisible && hasShift && !inOrder && !frozen && lateEnough;
  btn.style.display = show ? 'inline-block' : 'none';
}

function markPickingComplete(){
  if (!startTime) {
    if (typeof showToast === 'function') showToast('Start your shift before ending picking.');
    return;
  }
  if (current && Number.isFinite(current.total)) {
    if (typeof showToast === 'function') showToast('Finish or close the current order before ending picking.');
    return;
  }
  if (pickingCutoff) {
    if (typeof showToast === 'function') showToast('Picking has already been marked as finished.');
    return;
  }

  pickingCutoff = nowHHMM();

  if (typeof updateSummary === 'function') updateSummary();
  if (typeof updateEndPickingVisibility === 'function') updateEndPickingVisibility();
  if (typeof saveAll === 'function') saveAll();
  if (typeof showToast === 'function') {
    showToast('Picking finished – cleaning time will not affect Live Rate.');
  }
}

// ====== Downtime computation between orders ======
function computeDowntimes(picksArr, shiftBreaksArr){
  function toMin(hhmm){ return Math.round(hm(hhmm)*60); }
  function overlap(a1,a2,b1,b2){ return Math.max(0, Math.min(a2,b2)-Math.max(a1,b1)); }

  const gaps = [];
  const src  = Array.isArray(picksArr) ? picksArr : [];
  const sorted = src.slice().sort((a,b)=>hm(a.start)-hm(b.start));

  for (let i = 0; i < sorted.length - 1; i++){
    const endMin       = toMin(sorted[i].close);
    const nextStartMin = toMin(sorted[i+1].start);
    let   gap          = nextStartMin - endMin;

    if (gap > 0){
      let cut = 0;
      (shiftBreaksArr || []).forEach(b=>{
        if (!b || !b.start || !b.end) return;
        cut += overlap(endMin, nextStartMin, toMin(b.start), toMin(b.end));
      });

      gap = Math.max(0, gap - cut);
      if (gap >= 1){
        gaps.push({
          from:    minutesToHHMM(endMin),
          to:      minutesToHHMM(nextStartMin),
          minutes: gap
        });
      }
    }
  }
  return gaps;
}

// ====== End Shift → archive into History ======
async function endShift(){
  const recoveryMode = isShiftRecoveryMode?.() === true;

  if (!recoveryMode && current){
    return alert('Complete or undo the current order before ending the shift.');
  }
  if (!recoveryMode && !picks.length){
    return alert('No completed orders to archive.');
  }

  const dateStr = todayISO();

  // Shift length: null-safe
  const tLenEl = document.getElementById('tLen');
  const shiftLen = parseFloat(tLenEl?.value || '9');

  // Resolve active shift meta early for recovery fallback data
  let activeMeta = typeof getActiveShiftMeta === 'function' ? getActiveShiftMeta() : null;
  let shiftId = activeMeta?.id;

  let effectiveStartHHMM = startTime || shiftIsoToHHMM(activeMeta?.started_at || activeMeta?.start_time) || '';

  const totalUnits = picks.reduce((a,b)=> a + b.units, 0);
  const totalLocations = picks.reduce((a,b)=> a + (b.locations || 0), 0);
  const downtimes  = computeDowntimes(picks, shiftBreaks);
  const endHHMM    = nowHHMM();

  // If operative work is active at clock-out, close it at end time
  if (operativeActive && !operativeActive.end) {
    const toMin = (hhmm)=> Math.round(hm(hhmm) * 60);
    const start = operativeActive.start || endHHMM;
    const end   = endHHMM;
    const mins  = Math.max(0, toMin(end) - toMin(start));
    operativeActive.end     = end;
    operativeActive.minutes = mins;
  }

  // Worked & scheduled minutes to the minute (used by OT / weekly tiles)
  const toMin       = (hhmm)=> Math.round(hm(hhmm) * 60);
  let workedMin   = (effectiveStartHHMM && endHHMM) ? Math.max(0, toMin(endHHMM) - toMin(effectiveStartHHMM)) : 0;
  const scheduledMin= Math.round((shiftLen || 9) * 60);

  // Compute dailyPerf as average of perfPerHour from all orders
  let dailyPerf = 0;
  if (picks.length > 0) {
    const validPerfOrders = picks.filter(p => Number.isFinite(p.perfPerHour));
    if (validPerfOrders.length > 0) {
      const sumPerf = validPerfOrders.reduce((sum, p) => sum + p.perfPerHour, 0);
      dailyPerf = Math.round((sumPerf / validPerfOrders.length) * 10) / 10;
    }
  }

  // Resolve active shift id from persisted meta or backend
  if (!shiftId && window.WqtAPI?.fetchActiveShiftSession) {
    try {
      const server = await WqtAPI.fetchActiveShiftSession();
      const meta = server?.shift || null;
      if (meta) {
        activeMeta = persistActiveShiftMeta?.(meta) || meta;
        shiftId = activeMeta?.id;
        if (!effectiveStartHHMM) {
          effectiveStartHHMM = shiftIsoToHHMM(activeMeta?.started_at || activeMeta?.start_time) || effectiveStartHHMM;
          workedMin = (effectiveStartHHMM && endHHMM) ? Math.max(0, toMin(endHHMM) - toMin(effectiveStartHHMM)) : workedMin;
        }
      }
    } catch (err) {
      console.warn('[endShift] Failed to pull active shift from server', err);
    }
  }

  if (!shiftId) {
    showToast?.('Server has no active shift for you. Refresh or start a new shift.');
    return;
  }

  const snapshot = {
    date:        dateStr,
    start:       effectiveStartHHMM,
    end:         endHHMM || '',
    shiftLen,
    totalUnits,
    totalLocations,
    dayRate:     shiftLen > 0 ? Math.round(totalUnits / shiftLen) : 0, // keep day avg by full shift
    dayPerfScore: (workedMin > 0) ? Math.round(((totalUnits + totalLocations * 2) / (workedMin / 60)) * 10) / 10 : 0, // correct perf score: (units + 2*locations) / worked_hours
    dailyPerf:   dailyPerf, // NEW: average perfPerHour from all orders
    picks:       picks.slice(0),
    shiftBreaks: shiftBreaks.slice(0),
    downtimes,
    operativeLog: (operativeLog || []).slice(0),
    // NEW fields used by weekly overtime calc
    workedMin,
    scheduledMin
  };

  // Server-first end request
  try {
    await WqtAPI.endShiftSession({
      shiftId,
      totalUnits,
      avgRate: snapshot.dayRate,
      summary: snapshot,
      endTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[endShift] Backend end failed', err);
    showToast?.('Could not end shift on server. Please retry when online.');
    return;
  }

  // Local archive follows server success
  historyDays.push(snapshot);
  saveAll();
  renderHistory();
  renderWeeklySummary();

  clearActiveShiftMeta?.();
  clearShiftRecoveryMode?.();

  // Clear all shift state now that backend confirmed end
  if (typeof exitShiftNoArchive === 'function') {
    exitShiftNoArchive();
  }

  // Immediately persist the cleared state to localStorage
  if (typeof saveAll === 'function') {
    saveAll();
  }

  // Final safety: ensure shiftActive flag is off
  try {
    localStorage.setItem('shiftActive', '0');
    console.log('[endShift] Shift state fully cleared and persisted');
  } catch (e) {
    console.warn('[endShift] Failed to set shiftActive flag:', e);
  }

  showTab?.('tracker');    // land back on the Tracker start screen
  showToast?.('Shift archived to History');

  updateEndShiftVisibility?.();
  updateExitShiftVisibility?.();
  if (typeof refreshSummaryChips === 'function') refreshSummaryChips(); // Ensure chips are in sync
}

// Manual test matrix:
// 1) Start shift on Device A, end it → log into Device B and verify server reports no active shift and UI shows start modal.
// 2) Start shift, go offline, try End Shift → expect toast error and shift remains active until back online.
// 3) Log in fresh with a server-active shift → reconciliation modal offers Resume or End-now paths and UI follows server choice.

// ====== Clear today (keep shift active, nuke orders + logs) ======
// ====== Clear today (keep shift active, nuke orders + logs) ======
function clearToday(){
  if (!confirm("Clear today's order data? Your shift will remain active.")) return;

  // If there's no active shift, don't change layout – nothing to clear.
  const hasShift = !!startTime || (localStorage.getItem('shiftActive') === '1');
  if (!hasShift) {
    showToast?.("No active shift to clear.");
    return;
  }

  // Stop any running predictive/grace timers
  try { predictiveStop?.(); } catch(e){}
  try {
    if (window._predictiveGraceTimer) {
      clearTimeout(window._predictiveGraceTimer);
      window._predictiveGraceTimer = null;
    }
  } catch(e){}

  // Wipe order-specific in-memory state (KEEP the shift running)
  current     = null;
  tempWraps   = [];
  picks       = [];
  undoStack   = [];
  lastClose   = '';
  shiftBreaks = [];

  // --- Shared Pick RESET (ensure bar hides on refresh) ---
  try {
    persistSharedPadOpen(false);    // hide the bar immediately
    hideSharedPad?.();              // collapse UI
    localStorage.removeItem('sharedDockOpen');
    localStorage.removeItem('sharedMySum');
    localStorage.removeItem('sharedBlock');
    localStorage.removeItem('currentOrder');   // <-- critical so earlyRestore stops resurrecting shared mode
  } catch(e){}
  window.sharedMySum        = 0;
  window.sharedBlock        = 0;
  window._sharedProgressLeft = null;
  // ---------------------------------------------------------

  try { localStorage.setItem('shiftActive','1'); } catch(e){} // keep durable flag on

  // Also wipe shift-wide logs (operative + shift notes/delays)
  operativeActive = null;
  operativeLog    = [];
  breakDraft      = null; // cancel any in-flight break

  try { localStorage.removeItem('operativeActive'); } catch(e){}
  try { localStorage.removeItem('operativeLog'); } catch(e){}
  try { localStorage.removeItem('shiftDelays'); } catch(e){}
  try { localStorage.removeItem('shiftNotes'); } catch(e){}
  try { localStorage.removeItem('shiftOperatives'); } catch(e){}   // immutable operative store
  try {
    const nEl = document.getElementById('opNote');
    if (nEl) nEl.value = '';
  } catch(e){}

  // UI → Active Shift, no open order: show New-Order header form
  const shiftCard  = document.getElementById('shiftCard');
  const activeCard = document.getElementById('activeOrderCard');
  const doneCard   = document.getElementById('completedCard');
  if (shiftCard)  shiftCard.style.display  = 'none';
  if (activeCard) activeCard.style.display = 'block';
  if (doneCard)   doneCard.style.display   = 'none';

  const hdrForm = document.getElementById('orderHeaderForm');
  const hdrProg = document.getElementById('orderHeaderProgress');
  const area    = document.getElementById('orderArea');
  if (hdrForm) hdrForm.style.display = 'block';
  if (hdrProg) hdrProg.style.display = 'none';
  if (area)    area.style.display    = 'none';

  // Reset header fields to clean slate
  document.getElementById('progRate')?.replaceChildren(document.createTextNode('—'));
  document.getElementById('progETA') ?.replaceChildren(document.createTextNode('—'));
  const fill = document.getElementById('progFill');
  if (fill) fill.style.width = '0%';
  document.getElementById('progPct')   ?.replaceChildren(document.createTextNode('0%'));
  document.getElementById('progLeft')  ?.replaceChildren(document.createTextNode('0'));
  document.getElementById('progPallets')?.replaceChildren(document.createTextNode('0'));

  // Clear form inputs
  const oCust  = document.getElementById('oCust');   if (oCust)  oCust.value  = '';
  const oOther = document.getElementById('oOther');  if (oOther) oOther.value = '';
  const oTotal = document.getElementById('oTotal');  if (oTotal) oTotal.value = '';
  const oLeft  = document.getElementById('oLeft');   if (oLeft)  oLeft.value  = '';

  // Flip ghost button → "Exit Shift" (non-archiving)
  (function setExitShiftButton(){
    const btn = document.querySelector('.safetybar button.btn.ghost');
    if (!btn) return;
    btn.textContent = 'Exit Shift';
    btn.onclick = function(){ exitShiftNoArchive?.(); };
  })();

  // Persist & repaint
  saveAll?.();                 
  renderShiftPanel?.();        // clears Shift Log list
  renderTimeline?.();          // clears Order Log timeline
  refreshOperativeUI?.();      // hides/clears operative modal controls
  refreshOperativeChip?.();    // removes the chip bar
  ensureActionRowLayout?.();

  if (typeof updateEndShiftVisibility === 'function') updateEndShiftVisibility();
  if (typeof updateExitShiftVisibility === 'function') updateExitShiftVisibility();

  // land on Tracker
  if (typeof showTab === 'function') showTab('tracker');
}

// ====== Exit Shift (no archive) from History tab ======
function exitShiftFromHistory(){
  // If there is no active shift at all, nothing to do
  const hasShiftFlag = !!startTime || localStorage.getItem('shiftActive') === '1';
  if (!hasShiftFlag) {
    if (typeof showToast === 'function') {
      showToast('No active shift to exit.');
    } else {
      alert('No active shift to exit.');
    }
    updateExitShiftVisibility?.();
    return;
  }

  // If we still have completed orders, force the user to either archive or clear first
  if (Array.isArray(picks) && picks.length > 0) {
    if (typeof showToast === 'function') {
      showToast('You still have completed orders. Use "End Shift & Archive" or "Clear today\'s data" first.');
    } else {
      alert('You still have completed orders. Use "End Shift & Archive" or "Clear today\'s data" first.');
    }
    updateExitShiftVisibility?.();
    return;
  }

  // At this point, shift is active but clean (no picks) → safe to exit without archive
  if (typeof exitShiftNoArchive === 'function') {
    exitShiftNoArchive();
  } else {
    // Defensive: keep behaviour similar if the helper is optional
    exitShiftNoArchive?.();
  }

  // After exiting, re-evaluate buttons
  updateEndShiftVisibility?.();
  updateExitShiftVisibility?.();
}

// ====== Export / Import (gated) ======
function exportCSV(){
  let rows = [['#','Customer','Units','Locations','Pallets','Start','Closed','OrderRate']];
  picks.forEach((o,i)=>{
    var s = hm(o.start), e = hm(o.close);
    var excl = (o.log && Array.isArray(o.log.breaks))
      ? o.log.breaks.reduce((a,b)=>a+(b.minutes||0),0)
      : (o.excl||0);
    var net  = (e > s) ? (e - s) - (excl)/60 : 0.01;
    var rate = Math.round(o.units/Math.max(0.01,net));
    rows.push([i+1,o.name,o.units,(o.locations||0),o.pallets,o.start,o.close,rate]);
  });

  let csv  = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  let blob = new Blob([csv], {type:'text/csv'});
  let a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = 'today_picks.csv';
  a.click();
}

function exportJSON(){
  let data = {
    version:    '3.3.55',
    savedAt:    new Date().toISOString(),
    history:    historyDays,
    current,
    picks,
    startTime,
    lastClose,
    customCodes,
    shiftBreaks
  };
  let blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  let a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = 'wqt_export.json';
  a.click();
}

(function attachImport(){
  const inp = document.getElementById('impFile');
  if (!inp) return;

  inp.addEventListener('change', function(){
    const f = inp.files && inp.files[0];
    if (!f) return;

    const reader = new FileReader();
    reader.onload = function(){
      try {
        const obj = JSON.parse(reader.result || '{}');
        if (obj && obj.history && Array.isArray(obj.history)){
          historyDays = obj.history;
          picks      = Array.isArray(obj.picks) ? obj.picks : [];
          current    = obj.current || null;
          startTime  = obj.startTime || '';
          lastClose  = obj.lastClose || '';
          if (Array.isArray(obj.customCodes)) customCodes = obj.customCodes;
          shiftBreaks = Array.isArray(obj.shiftBreaks) ? obj.shiftBreaks : [];

          saveAll();
          renderHistory();
          renderDone();
          reloadDropdowns();
          updateSummary();
          showToast?.('Import complete');
        } else {
          alert('Invalid JSON file');
        }
      } catch(e){
        alert('Import failed: ' + e.message);
      }
      inp.value = '';
    };
    reader.readAsText(f);
  });
})();

// ====== Manage Customers (gated) ======
function toggleManageCustomers(){
  const card = document.getElementById('manageCustomersCard');
  if (!card) return;
  const open = card.classList.contains('hidden');
  card.classList.toggle('hidden', !open);
  if (open) renderCustomTags();
}

function renderCustomTags(){
  const box = document.getElementById('custTags');
  if (!box) return;
  box.innerHTML = '';

  (customCodes || []).forEach((code)=>{
    const tag = document.createElement('span');
    tag.className = 'tag';

    const btn = document.createElement('button');
    btn.textContent = '✖';
    btn.title = 'Remove';
    btn.addEventListener('click', function(){ removeCustomCode(code); });

    tag.textContent = code + ' ';
    tag.appendChild(btn);
    box.appendChild(tag);
  });
}

function removeCustomCode(code){
  customCodes = (customCodes || []).filter(c=>c!==code);
  saveCustomCodes();
  renderCustomTags();
  reloadDropdowns();
  showToast?.('Removed ' + code);
}

function clearAllCustom(){
  if (!confirm('Remove ALL custom customers?')) return;
  customCodes = [];
  saveCustomCodes();
  renderCustomTags();
  reloadDropdowns();
  showToast?.('All custom customers cleared');
}