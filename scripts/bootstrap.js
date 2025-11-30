// ====== State ======

// Closed orders (completed picks)
let picks = [];         // closed orders

// ETA smoothing (GPS-style) – keeps predictive ETA from bouncing
let etaSmooth = [];            // rolling window of recent order rates
let lastETAmin = null;         // last computed (smoothed) ETA in minutes
let lastRenderedETAmin = null; // last value we actually showed (for 1m threshold)

// Reset predictive ETA smoothing buffer
function resetEtaSmoother(){
  etaSmooth = [];
  lastETAmin = null;
  lastRenderedETAmin = null;
}

// Hide the shared-dock panel and persist that choice
function hideSharedDock(){
  persistSharedPadOpen(false);
  localStorage.setItem('sharedDockOpen','0');
}

// ---- Early restore & safety nets (v3.5) ----

// ===== Predictive config/state =====
// Simple config object for predictive tick + clamped live rate
const PREDICT = {
  tickMs: 1000,   // 1s tick interval for predictive updater
  alpha: 0.20,    // reserved for future smoothing if you want it
  minRate: 60,    // minimum live rate clamp
  maxRate: 600    // maximum live rate clamp
};

// Shared Pick state – one sharedSession per multi-picker order
let sharedSession = null;

// Open modal for shared pick logging (splits units between pickers)
function openSharedPickModal(){
  const sel   = document.getElementById('oCust');
  const total = parseInt(document.getElementById('oTotal').value||'0',10);
  const name  = sel?.value || '';

  sharedSession = {
    name,
    total,
    entries: [],    // individual picker entries
    wraps: [],      // wrap logs within shared pick
    start: nowHHMM()
  };

  document.getElementById('sharedHeader').textContent = `Customer: ${name} | Total: ${total}`;
  document.getElementById('sharedUnits').value = '';
  document.getElementById('sharedSummary').textContent = 'No entries yet.';
  document.getElementById('sharedModal').style.display = 'flex';
}

// ─── Dynamic Start Picker (contracted start) ──────────────────────────────────
// NOTE: these globals are used by the "contracted start" modal logic
window._chosenShiftLen = null;
window._chosenStartHHMM = null;

// Close the contracted-start modal
function closeContractModal(){
  const modal = document.getElementById('contractModal');
  if (modal) modal.style.display = 'none';
}

// Snap a HH:MM value forward to the next 15-minute block
function snapForwardQuarter(hhmm) {
  const h = hm(hhmm);                   // hours as float
  if (isNaN(h)) return hhmm;
  const minutes = Math.round(h * 60);   // integer minutes
  const snapped = Math.ceil(minutes / 15) * 15; // snap forward
  const HH = Math.floor(snapped / 60) % 24;
  const MM = snapped % 60;
  return (HH < 10 ? '0' : '') + HH + ':' + (MM < 10 ? '0' : '') + MM;
}


function getSnappedStartHHMM() {
  return snapForwardQuarter(startTime || nowHHMM());
}

// Decide which HH:MM to treat as the "end" of picking
function getEffectiveLiveEndHHMM(){
  // If an order is running, live really means "now"
  if (current && Number.isFinite(current.total)) {
    return nowHHMM();
  }
  // If we've explicitly frozen picking (cleaning), stay at that time
  if (pickingCutoff) return pickingCutoff;
  // Otherwise, fall back to last closed order if we have one
  if (lastClose) return lastClose;
  // Last resort: now
  return nowHHMM();
}

// === SharedPad Persistence + Auto-Hide Helpers ===

// Open dynamic start picker with chosen shift length (e.g. 9h / 10h)
function openDynamicStartPicker(len){
  // Store today’s chosen shift length in the hidden field; no long-term preference
  const lenEl = document.getElementById('tLen');
  if (lenEl) lenEl.value = String(len || 9);
  openContractedStartPicker();
}

// Apply contracted start logic and log lateness for the day
function applyContractedStart(hhmm){
  closeContractModal();

  // Use stored preference for shift length or default 9h
  const prefLen = getShiftPref() || 9;
  const lenEl = document.getElementById('tLen');
  if (lenEl) lenEl.value = String(prefLen);

  // Backward compatible: numeric hour → HH:00, else use string
  const contracted = (typeof hhmm === 'number')
    ? ((hhmm<10?'0':'') + hhmm + ':00')
    : String(hhmm);

  const actual = nowHHMM();
  const cMin = hmToMin(contracted);
  const aMin = hmToMin(actual);

  // Effective start = contracted if on-time/early; else actual if late
  const effectiveMin = (aMin <= cMin) ? cMin : aMin;
  const effectiveHM  = minToHm(effectiveMin);

  // Baseline live rate anchor: shift "start"
  startTime = effectiveHM;

  // Lateness log (per-day record of contracted vs actual)
  const lateMin = aMin - cMin;
  try {
    const day = new Date().toISOString().slice(0,10);
    const raw = localStorage.getItem(LATE_LOG_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj[day] = { contracted, actual, effective: effectiveHM, lateMin, shiftLen: prefLen };
    localStorage.setItem(LATE_LOG_KEY, JSON.stringify(obj));
  } catch(e) {}

  // Proceed to S2 and show note
  beginShift();
  if (typeof updateSummary === 'function') updateSummary();

  // Human-readable lateness text for the pre-order note
  let note = 'on time';
  if (lateMin > 0)      note = `${lateMin}m late`;
  else if (lateMin < 0) note = `${-lateMin}m early`;
  showPreOrderNote?.(`Contracted ${hmTo12(contracted)} • Actual ${hmTo12(actual)} (${note})`);
}

// Open the Pro Settings modal (advanced config)
function openProSettingsModal(){
  const m = document.getElementById('proSettingsModal');
  if (!m) return;
  m.style.display = 'flex';
}

// Open the Operative Work modal (for non-picking work logs)
function openOperativeModal(){
  const m = document.getElementById('operativeModal');
  if (!m) return;
  m.style.display = 'flex';

  // Pre-fill note from active or last block for convenience
  const noteEl = document.getElementById('opNote');
  if (noteEl){
    const src = operativeActive || (operativeLog.length ? operativeLog[operativeLog.length-1] : null);
    noteEl.value = (src && src.note) ? src.note : '';
  }
  refreshOperativeUI();
}

// Entry point when starting a break/lunch via Operative modal
function opOpenBreak(kind){
  // Record context: were we in an order and was operative running?
  window._breakStartNoOrder = !window.current;
  window._opWasRunningAtBreakStart = !!operativeActive;

  // If operative is running, DO NOT stop it.
  // Just drop an operative-tagged note for the break/lunch start.
  try {
    if (window._opWasRunningAtBreakStart) {
      const key = 'shiftNotes';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      const label = (kind === 'L') ? 'Lunch' : 'Break';
      arr.push({ t: nowHHMM(), note: `${label} started`, op: true });
      localStorage.setItem(key, JSON.stringify(arr));
    }
  } catch(e){}

  // Close the operative modal to avoid stacked overlays
  closeOperativeModal();

  // Open the existing break/lunch flow (kind = 'B' or 'L')
  openBreakModal(kind);
}

// Update the top-bar Operative chip (mini timer + dot)
function refreshOperativeChip(){
  const bar = document.getElementById('opChipBar');
  const el  = document.getElementById('opChipElapsed');
  if (!bar || !el) return;

  // Optional: if you have a dot/icon span, flip it green safely.
  const dot = document.getElementById('opChipDot'); // safe optional

  if (operativeActive && !operativeActive.end){
    bar.style.display = 'flex';
    try {
      const toMin = (hhmm)=> Math.round(hm(hhmm) * 60);
      const start = operativeActive.start;
      const end   = nowHHMM();
      const mins  = Math.max(0, toMin(end) - toMin(start));
      const h = Math.floor(mins/60), m = mins%60;
      el.textContent = (h>0 ? `${h}h ` : '') + `${m}m`;
    } catch(e){}
    if (dot) dot.textContent = '🟢'; // green while running
  } else {
    bar.style.display = 'none';
    if (dot) dot.textContent = '🟠'; // fallback color when not running
  }
}

// Close the Operative modal
function closeOperativeModal(){
  const m = document.getElementById('operativeModal');
  if (!m) return;
  m.style.display = 'none';
}

// IIFE: backdrop-click to close Operative modal
(function(){
  // backdrop click to close
  document.getElementById('operativeModal')?.addEventListener('click', (e)=>{
    if (e.target?.id === 'operativeModal') closeOperativeModal();
  });
})();

// Interval handle for live operative timer
let _opTicker = null;

// Refresh main Operative UI (button label + elapsed timer)
// Also drives the 1s ticker while operativeActive exists
function refreshOperativeUI(){
  const btn = document.getElementById('opToggleBtn');
  const el  = document.getElementById('opElapsed');
  if (!btn || !el) return;

  if (operativeActive){
    btn.textContent = 'Stop Operative Work';
    // start / update ticker
    if (_opTicker) clearInterval(_opTicker);
    _opTicker = setInterval(()=>{
      try {
        const toMin = (hhmm)=> Math.round(hm(hhmm) * 60);
        const start = operativeActive.start;
        const end   = nowHHMM();
        const mins  = Math.max(0, toMin(end) - toMin(start));
        const h = Math.floor(mins/60), m = mins%60;
        el.textContent = (h>0 ? `${h}h ` : '') + `${m}m`;
        refreshOperativeChip();

      } catch(e) {}
    }, 1000);
  } else {
    btn.textContent = 'Start Operative Work';
    el.textContent = '—';
    refreshOperativeChip();
    if (_opTicker) { clearInterval(_opTicker); _opTicker = null; }
  }
}

// Toggle wrapper for Operative button
function toggleOperative(){
  if (operativeActive) stopOperative();
  else startOperative();
}

// Start an Operative block (non-picking work)
// NOTE: shift must be started; we do not auto-start a shift here.
function startOperative(){
  if (!startTime) { showToast('Start your shift first'); return; }
  if (operativeActive) return;

  // ensure log exists
  window.operativeLog = Array.isArray(window.operativeLog) ? window.operativeLog : [];

  const note = (document.getElementById('opNote')?.value || '').trim();
  const now  = nowHHMM();

  // capture whether we started with or without an active order
  const block = { start: now, end: null, minutes: null, note, noOrder: !window.current };

  // keep a single shared object referenced by both active + log
  operativeLog.push(block);
  operativeActive = block;

  // IMPORTANT: no "started" note now — we write both start & end notes on stop

  showToast('Operative started');
  refreshOperativeUI?.();
  refreshOperativeChip?.();
  renderShiftPanel?.();      // shows the single green live line
  renderTimeline?.();        // harmless; Order Log won’t render operative rows anyway
  updateDelayBtn?.();        // hide Log/Delay button while operative active
  saveAll?.();
}

// Stop the active Operative block and persist everything
function stopOperative(){
  if (!operativeActive) return;

  const toMin = (hhmm)=> Math.round(hm(hhmm) * 60);
  const start = operativeActive.start;
  const end   = nowHHMM();
  const mins  = Math.max(0, toMin(end) - toMin(start));

  // finalize active block
  operativeActive.end     = end;
  operativeActive.minutes = mins;

  // ensure it's in operativeLog
  if (!Array.isArray(operativeLog)) operativeLog = [];
  if (!operativeLog.includes(operativeActive)) {
    operativeLog.push(operativeActive);
  }

  // Write BOTH bracket markers now: "started" and "ended — total"
  try {
    const key = 'shiftNotes';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');

    // “Operative started — <optional note>” at the original start time
    const startedMsg = operativeActive.note
      ? `Operative started — ${operativeActive.note}`
      : 'Operative started';
    arr.push({ t: start, note: startedMsg, op: true });

    // “Operative ended — Xh Ym” at the end time
    const h = Math.floor((mins || 0) / 60);
    const m = (mins || 0) % 60;
    const total = (h > 0 ? `${h}h ` : '') + `${m}m`;
    arr.push({ t: end, note: `Operative ended — ${total}`, op: true });

    localStorage.setItem(key, JSON.stringify(arr));
  } catch(e){}

  // Persist immutable range (kept for analytics/history)
  try {
    const key  = 'shiftOperatives';
    const arr  = JSON.parse(localStorage.getItem(key) || '[]');
    arr.push({
      start: operativeActive.start,
      end:   operativeActive.end,
      minutes: operativeActive.minutes,
      note:  operativeActive.note || '',
      noOrder: !!operativeActive.noOrder
    });
    localStorage.setItem(key, JSON.stringify(arr));
  } catch(e){}

  operativeActive = null;

  showToast('Operative stopped');
  saveAll?.();
  refreshOperativeUI?.();
  renderTimeline?.();
  refreshOperativeChip?.();
  renderShiftPanel?.();
  updateDelayBtn?.();
}

// Save a free-form operative note into shiftNotes
// (does NOT attach to the live operative block to avoid noisy labels)
function saveOperativeNote(){
  const el = document.getElementById('opNote');
  if (!el) return;

  const txt = (el.value || '').trim();
  if (!txt){ showToast?.('Type a note'); return; }

  try {
    const key = 'shiftNotes';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    arr.push({ t: nowHHMM(), note: txt, op: !!(operativeActive && !operativeActive.end) });
    localStorage.setItem(key, JSON.stringify(arr));
  } catch(e){}

  // do NOT attach note to the live block (prevents “Operative running — …”)
  el.value = '';
  saveAll?.();
  renderShiftPanel?.();
  renderTimeline?.();
  showToast?.('Note saved');
}

// Close the Pro Settings modal
function closeProSettingsModal(){
  const m = document.getElementById('proSettingsModal');
  if (!m) return;
  m.style.display = 'none';
}
// ─── Patch startShift to honour chosen HH:MM ──────────────────────────────────
// We avoid changing your original logic; we just enforce startTime after startShift.
(function wrapStartShiftToUseChosenStart(){
  if (typeof startShift !== 'function') {
    // If startShift isn't defined yet, retry after scripts finish loading
    // (this makes the wrapper resilient to script ordering).
    setTimeout(wrapStartShiftToUseChosenStart, 0);
    return;
  }
  const _origStartShift = startShift;
  startShift = function(len){
    // If a chosen time exists, apply BEFORE calling original
    // (in case original reads startTime for UI).
    if (window._chosenStartHHMM) {
      window.startTime = window._chosenStartHHMM;
      try { localStorage.setItem('shiftActive','1'); } catch(e){}
    }

    _origStartShift.call(this, len);

    // And ensure it sticks if original overwrote it
    if (window._chosenStartHHMM) {
      window.startTime = window._chosenStartHHMM;
      try { localStorage.setItem('shiftActive','1'); } catch(e){}
      // Clear the choice so future shifts use live snapping again
      window._chosenStartHHMM = null;
    }
  };
})();

// Add a units entry to the Shared Pick modal and update summary
function sharedAddUnits() {
  const input = document.getElementById('sharedUnits');
  const val = parseInt(input.value || '0', 10);
  if (!(val > 0)) return alert('Enter units first');

  // Add to shared session units
  const entry = { units: val, t: nowHHMM() };
  sharedSession.entries.push(entry);

  input.value = '';

  const sum = sharedSession.entries.reduce((a, b) => a + b.units, 0);
  document.getElementById('sharedSummary').textContent =
    `Total so far: ${sum} units (${sharedSession.entries.length} entries)`;

  // Update the total units display
  document.getElementById('chipTotalVal').textContent = sum;
}

// Close Shared Pick modal and archive partial shared order → picks[]
function closeSharedPickModal(){
  document.getElementById('sharedModal').style.display = 'none';

  // archive partial shared order
  if(sharedSession && sharedSession.entries.length){
    const totalUnits = sharedSession.entries.reduce((a,b)=>a+b.units,0);
    const entry = {
      name: sharedSession.name,
      shared: true,
      units: totalUnits,
      wraps: sharedSession.wraps.slice(),
      start: sharedSession.start,
      closed: nowHHMM()
    };
    picks.push(entry);
    renderTimeline();
    saveAll();
    showToast?.(`Shared order saved (${totalUnits} units).`);
  }
  sharedSession = null;
}

// Shared mode state
let sharedMySum = 0;        // my contributed units
let sharedWraps = [];       // [{ left, t }]
let sharedStartedAt = null; // HH:MM when I started
window._sharedProgressLeft = null; // progressive "left" overlay for header

// Open a full shared order as "current" and kick S3 UI into shared mode
function openSharedStart() {
  // Initialize shared session state
  sharedSession = {
    name: document.getElementById('oCust').value,
    total: parseInt(document.getElementById('oTotal').value, 10),
    entries: [],
    wraps: [],
    start: nowHHMM()
  };

  // Start the order, which also triggers all order UI and behaviors
  startOrder();  // This starts the order as usual

  // Now set current.shared = true to indicate it's a shared order
  if (current) {
    current.shared = true;

    // Initialise shared counters for this session
    window.sharedMySum = 0;
    window.sharedBlock = 0;

    // Open + persist the Shared Pick bar state
    persistSharedPadOpen(true);
    try { localStorage.setItem('sharedDockOpen', '1'); } catch(e) {}

    updateSharedDockInfo?.();

    // Same immediate UI kick as normal start (elapsed chip etc.)
    const chip = document.getElementById('chipElapsed');
    if (chip) {
      chip.style.display = '';
      const label = chip.querySelector('b');
      if (label) label.textContent = 'Elapsed';
    }
    updateElapsedChip?.();
    setElapsedChipClickable?.(true);
    updateCloseEarlyVisibility?.();

    // CRITICAL: persist the updated current (with shared flag) for refresh restore
    try {
      localStorage.setItem('currentOrder', JSON.stringify(current));
    } catch (e) {
      console.warn('Failed to persist shared currentOrder:', e);
    }
  }

  // Update the Total Units, Left, and other progress bar elements
  if (current && Number.isFinite(+current.total)) {
    document.getElementById('progLeft').textContent = current.total;
  } else {
    document.getElementById('progLeft').textContent = '0';
  }
  document.getElementById('progRate').textContent = '—';
  document.getElementById('progPct').textContent = '0%';
  document.getElementById('progFill').style.width = '0%';
  updateProgressHeader?.();
  updateHeaderActions?.();

  // Shared dock info already initialised above; just ensure focus on the bar input
  setTimeout(() => document.getElementById('padUnits')?.focus(), 0);
}

// 2) Hook after startOrder completes: flip into shared mode & show dock
// NOTE: this wrapper only runs if startOrder exists at parse time.
(function attachSharedStartHook(){
  if (typeof startOrder !== 'function') return;
  const _origStartOrder = startOrder;
  startOrder = function(...args){
    _origStartOrder.apply(this, args);

    if (window._sharedStart) {
      window._sharedStart = false;

      if (!window.current) return; // safety
      window.current.shared = true;
      sharedMySum = 0;
      sharedWraps = [];
      sharedStartedAt = window.current.start || nowHHMM();
      window._sharedProgressLeft = window.current.total;

      // init shared counters
      window.sharedMySum = 0;
      window.sharedBlock = 0;
      updateSharedDockInfo?.();

      // show S3 header (already shown by startOrder), ensure actions visible
      showProgressHeader?.();
      updateHeaderActions?.();

      showSharedPad?.();
      localStorage.setItem('sharedDockOpen','1');
      updateSharedDockInfo?.();
      setTimeout(()=> document.getElementById('padUnits')?.focus(), 0);

    }
  };
})()

function sharedCancel(){
  if (!confirm('Discard shared progress?')) return;

  // Hide the bar now
  try { persistSharedPadOpen(false); } catch(e){}
  hideSharedPad?.();

  // Reset in-memory shared state
  sharedMySum = 0;
  window.sharedBlock = 0;
  sharedWraps = [];
  sharedStartedAt = null;
  window._sharedProgressLeft = null;

  // Clear persistence flags/values
  try {
    localStorage.removeItem('sharedDockOpen');
    localStorage.removeItem('sharedMySum');
    localStorage.removeItem('sharedBlock');
    localStorage.removeItem('currentOrder');   // stop earlyRestore reviving dead shared orders
  } catch(e){}

  // Make sure the live current order is no longer “shared”
  if (current && current.shared) {
    delete current.shared;
    try { saveAll?.(); } catch(e){}
  }

  // Refresh header to remove overlay immediately
  try {
    updateSharedDockInfo?.();
    updateProgressHeader?.();
  } catch(e){}
}

// Predictive ETA/live-rate state bundle
let predictive = {
  timer: null,
  lastTick: 0,
  left: 0,
  rateUh: 0,
  firstWrapSeen: false
};

// Key builder for "first order today" flag
function shiftDateKey(){
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return `predictive-first-order-done-${y}-${m}-${dd}`;
}
function isFirstOrderToday(){ return !localStorage.getItem(shiftDateKey()); }
function markFirstOrderStarted(){ localStorage.setItem(shiftDateKey(), '1'); }

// Early restore pipeline for break + shared-order state on load
function earlyRestore(){
  try {
    // ── 1. Restore active break/lunch early and bail if needed ──
    try {
      const raw = localStorage.getItem('breakDraft');
      if (raw) {
        breakDraft = JSON.parse(raw);
        if (breakDraft) {
          restoreBreakDraftIfAny();
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to restore active break/lunch:', e);
    }

    // ── 2. Load all saved data first ──
    loadAll?.();
    restoreBreakDraftIfAny?.();

    // ── 3. Try to rehydrate any partial Shared Order state ──
    try {
      const stored = localStorage.getItem('currentOrder');
      if (stored && !window.current) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          window.current = parsed;
        }
      }

      const sm = parseInt(localStorage.getItem('sharedMySum') || '0', 10);
      const sb = parseInt(localStorage.getItem('sharedBlock') || '0', 10);
      window.sharedMySum = (isFinite(sm) && sm >= 0) ? sm : 0;
      window.sharedBlock = (isFinite(sb) && sb >= 0) ? sb : 0;
    } catch(e) {
      console.warn('Shared session rehydrate failed', e);
    }

    // ── 4. Shared dock: always show pad when in a shared order ──
    const isShared = !!(window.current && window.current.shared);

    if (isShared) {
      // Keep bar open + bottom padding consistent
      persistSharedPadOpen(true);
      try { localStorage.setItem('sharedDockOpen','1'); } catch(e){}

      // Rebuild shared progress + predictive ETA if we have a live total
      if (current && Number.isFinite(+current.total)) {
        const total = +current.total;
        const left  = Math.max(0, total - (window.sharedMySum || 0));
        window._sharedProgressLeft = left;

        try {
          updateLeftLabel?.(left);
          const pct = total ? ((total - left) / total) * 100 : 0;
          setProgress?.(pct);
          const pctEl = document.getElementById('progPct');
          if (pctEl) pctEl.textContent = Math.round(pct) + '%';
        } catch(e){}

        try {
          const rateUh = Math.round(orderLiveRate?.() || getLiveRateUh?.() || 0);
          predictiveReset?.(left, rateUh);
          predictiveStart?.();
        } catch(e){}
      }

      try { updateSharedDockInfo?.(); } catch(e){}
      setTimeout(() => document.getElementById('padUnits')?.focus(), 100);

    } else {
      // Not in shared mode → bar should be hidden and preference reset
      persistSharedPadOpen(false);
      try { localStorage.setItem('sharedDockOpen','0'); } catch(e){}
      window.sharedMySum = 0;
      window.sharedBlock = 0;
      try { updateSharedDockInfo?.(); } catch(e){}
    }

    // ── 5. Ensure UI re-renders for any active order ──
    if (current && Number.isFinite(+current.total)) {
      try {
        restoreActiveOrderUI?.();
        updateHeaderActions?.();
        updateSummary?.();
        updateElapsedChip?.();
      } catch(e){}
    }

    // ── 6. Persist current shared order snapshot for next refresh ──
    try {
      if (window.current && window.current.shared) {
        localStorage.setItem('currentOrder', JSON.stringify(window.current));
      }
    } catch(e){}

  } catch (e) {
    console.warn('earlyRestore failed:', e);
  }
}

// Standalone: shared pick modal opener (keep this at top level)
//
// ⚠️ IMPORTANT: This is a SECOND definition of openSharedPickModal,
// and will overwrite the earlier fully implemented one above in the file.
// Almost certainly this should be removed or merged later.
function openSharedPickModal(){
  // TODO (Phase 2): open shared order modal with per-location entry + in-modal Log Wrap
  try { showToast?.('Shared Pick coming next — button wired.'); } catch(e){}
}

// Exit shift without archiving; return UI to Start state
function exitShiftNoArchive(){
  if (current) { alert('Complete or undo the current order before exiting the shift.'); return; }
  try { predictiveStop?.(); } catch(e){}

  // Clear shift session (no archive)
  picks = [];
  lastClose = '';
  current = null;
  tempWraps = [];
  undoStack = [];
  shiftBreaks = [];
  startTime = '';
  pickingCutoff = '';
  try { localStorage.setItem('shiftActive','0'); } catch(e){}

  // UI → Start Shift screen
  const shiftCard  = document.getElementById('shiftCard');
  const activeCard = document.getElementById('activeOrderCard');
  const doneCard   = document.getElementById('completedCard');
  if (shiftCard)  shiftCard.style.display  = 'block';
  if (activeCard) activeCard.style.display = 'none';
  if (doneCard)   doneCard.style.display   = 'none';

  const hdrForm = document.getElementById('orderHeaderForm');
  const hdrProg = document.getElementById('orderHeaderProgress');
  const area    = document.getElementById('orderArea');
  if (hdrForm) hdrForm.style.display = 'block';
  if (hdrProg) hdrProg.style.display = 'none';
  if (area)    area.style.display    = 'none';

  ['btnB','btnL','btnUndo','btnComplete'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const btnStart = document.getElementById('btnStart');
  if (btnStart) { btnStart.style.display='inline-block'; btnStart.disabled = true; }

  const fill = document.getElementById('progFill'); if (fill) fill.style.width = '0%';
  document.getElementById('progPct')?.replaceChildren(document.createTextNode('0%'));
  document.getElementById('progLeft')?.replaceChildren(document.createTextNode('0'));
  document.getElementById('progPallets')?.replaceChildren(document.createTextNode('0'));
  document.getElementById('progRate')?.replaceChildren(document.createTextNode('—'));
  document.getElementById('progETA')?.replaceChildren(document.createTextNode('—'));

  saveAll?.();
  showToast?.('Shift ended.');

  // After exiting shift, repurpose the ghost button as a one-click restart
  (function setRestartButton(){
    const btn = document.querySelector('.safetybar button.btn.ghost');
    if (!btn) return;
    btn.textContent = 'Refresh App';
    btn.onclick = function(){ location.reload(); }; // hard reload to clean state
  })();
}

// Delay / Break (declare BEFORE earlyRestore so restoreBreakDraftIfAny sees it)
let delayDraft = null; // {start:'HH:MM', cause:''}
let breakDraft = null; // {type:'B'|'L', startHHMM, targetSec, beeping}
let breakTickId = null;

// Rebuild break UI if a persisted draft exists (call once after loadAll())
function restoreBreakDraftIfAny(){
  if (!breakDraft) return;
  const mins = Math.round((breakDraft.targetSec || 0) / 60) || (breakDraft.type==='B' ? 20 : 30);

  // rebuild bar
  const titleEl  = document.getElementById('breakBarTitle');
  const startEl  = document.getElementById('breakBarStart');
  const targetEl = document.getElementById('breakBarTarget');
  const barEl    = document.getElementById('breakBar');

  if (titleEl)  titleEl.textContent  = (breakDraft.type==='B'?'Break':'Lunch');
  if (startEl)  startEl.textContent  = breakDraft.startHHMM || '—';
  if (targetEl) targetEl.textContent = mins+' min target';
  if (barEl)    barEl.style.display  = 'flex';

  const chipBox = document.getElementById('chipElapsed');
  if (chipBox) chipBox.style.display = '';

  // ensure ticking resumes
  tickBreak();
  if (breakTickId) clearInterval(breakTickId);
  breakTickId = setInterval(tickBreak, 1000);
}

// 1) Preload any saved break *before* we try to restore UI
(function preloadBreakDraft(){
  const saved = localStorage.getItem('breakDraft');
  if (saved) {
    try { breakDraft = JSON.parse(saved); } catch(e){ breakDraft = null; }
  }
})();

// 2) Now restore UI & timers from the preloaded draft
// Defer so SharedPad helpers (showSharedPad/hideSharedPad) are defined first
setTimeout(earlyRestore, 0);

// 3) Keep persisting while a break is active
setInterval(()=>{
  if (breakDraft) localStorage.setItem('breakDraft', JSON.stringify(breakDraft));
}, 3000);

// Persist shared currentOrder snapshot if tab is closed mid-shared-order
window.addEventListener('beforeunload', ()=>{
  try {
    if (window.current && window.current.shared) {
      localStorage.setItem('currentOrder', JSON.stringify(window.current));
    }
  } catch(e){}
});

// Persist periodically + on tab close
window.addEventListener('beforeunload', saveAll);
setInterval(saveAll, 1500);

// Last non-zero pace we painted with (for tint fallback)
let uiLastPaceUh = 0;

// Core in-memory state objects
let tempWraps = [];     // wraps in current order
let current = null;     // active order
let startTime = "";     // shift start (HH:MM)
let lastClose = "";     // last order close time
let pickingCutoff = ""; // HH:MM when picking is finished for the day (cleaning after this)
let undoStack = [];     // undo actions for current order
let historyDays = [];   // archived days
let customCodes = [];   // user-added customer codes
let operativeLog = [];      // [{ start:'HH:MM', end:'HH:MM'|null, minutes?:number, note?:string }]
let operativeActive = null; // { start:'HH:MM', end:null, note?:string }
let shiftBreaks = [];   // breaks without an active order
let learnedUL = {};     // U/Layer frequency map (persisted via KEY_LEARN)

// Countback focus & values (for CB mini-panel)
let cbFocus = 'layers'; // 'layers' | 'ul' | 'extras'
let cbVals = {layers:'', ul:'', extras:''};

// Add minutes to a specific HH:MM (not “now”), return HH:MM
function addMinutesToTime(hhmm, minutesToAdd){
  const [h,m] = (hhmm || '00:00').split(':').map(x => parseInt(x,10) || 0);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setMinutes(d.getMinutes() + Math.max(0, Math.round(minutesToAdd || 0)));
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${hh}:${mm}`;
}

// Minimal toggle for per-day delete mode used by the Clear History button
window._histDeleteMode = false;

function clearHistory(){
  // flip mode
  window._histDeleteMode = !window._histDeleteMode;

  // re-render list so per-day ✖ visibility matches the mode
  renderHistory();

  // update the top button label
  const topBtn = document.querySelector('button[onclick="clearHistory()"]');
  if (topBtn) topBtn.textContent = window._histDeleteMode ? 'Done' : 'Clear History';

  // if history is empty, auto-exit delete mode and normalize label
  if (!historyDays.length) {
    window._histDeleteMode = false;
    if (topBtn) topBtn.textContent = 'Clear History';
  }
}

// Core storage keys / unlock codes
const KEY = 'wqt_v2722_data';
const KEY_CODES = 'wqt_codes';
const KEY_LEARN = 'wqt_learn_ul';
const PRO_UNLOCK_CODE = '0000';
const OPER_UNLOCK_CODE = '2222';
const SNAKE_UNLOCK_CODE = '1234';   // <- Snake secret code

let proUnlocked  = false;  // Gate: Export/Import/Manage Customers
let snakeUnlocked = false; // Gate: Snake congestion game

// Persisted preference: one-time shift length (hours)
const SHIFT_PREF = 'wqt.shiftLenH';

// Extra safety net save in case the main 1500ms one misses something
setInterval(function(){ saveAll(); }, 30000);

// Clear the "snapped to" hint text
function clearStartHint(){
  const hint = document.getElementById('snapHint');
  if (hint) hint.textContent = '';
}

// Fetch stored 9h/10h preference (or null)
function getShiftPref(){
  const v = localStorage.getItem(SHIFT_PREF);
  const n = parseInt(v, 10);
  return (n === 9 || n === 10) ? n : null;
}
function setShiftPref(n){
  if (n === 9 || n === 10) localStorage.setItem(SHIFT_PREF, String(n));
}

// ---- Lateness logging ----
const LATE_LOG_KEY = 'wqt.lateLog'; // { "YYYY-MM-DD": {contracted, actual, lateMin, shiftLen} }

// Minutes difference between two HH:MM
function minutesBetween(hmA, hmB){
  const [aH,aM] = (hmA||'0:0').split(':').map(x=>parseInt(x,10)||0);
  const [bH,bM] = (hmB||'0:0').split(':').map(x=>parseInt(x,10)||0);
  return (bH*60 + bM) - (aH*60 + aM);
}

// HH:MM → absolute minutes
function hmToMin(hm){
  const [h,m] = (hm||'0:0').split(':').map(x=>parseInt(x,10)||0);
  return h*60 + m;
}

// absolute minutes → HH:MM
function minToHm(min){
  const h = Math.floor(min/60), m = min%60;
  return (h<10?'0':'')+h+':'+(m<10?'0':'')+m;
}

// ==== Local storage keys ====
const LS = {
  CURRENT: 'wqt.current',
  WRAPS: 'wqt.wraps',
  PICKS: 'wqt.picks',
  START: 'wqt.startTime',
  UNDO: 'wqt.undo',
  LAST_CLOSE: 'wqt.lastClose',
  VERSION: 'wqt.v2'
};
// ====== Utils ======

// Quick “is there a sane current order?” guard
function hasActiveOrder(){
  return !!(current && current.start && current.name && (current.total|0) > 0);
}

// Toast message (small popup at bottom)
function showToast(msg){
  try{
    var t=document.getElementById('toast');
    t.textContent=msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),1400);
  }catch(e){}
}

// HH:MM → hours as float (e.g. "18:30" → 18.5)
function hm(str){
  if(!str) return NaN;
  var a=str.split(':'), H=parseInt(a[0],10), M=parseInt(a[1],10);
  if(isNaN(H)||isNaN(M)) return NaN;
  return H + M/60;
}

// HH:MM → integer minutes (rounding)
function hhmmToMinutes(hhmm){
  const v = hm(hhmm);                 // hm("18:11") → 18.1833…
  return isNaN(v) ? 0 : Math.round(v * 60);
}

// Inline hint under the progress header when shift starts
function showStartNote(text){
  const host = document.getElementById('orderHeaderProgress');
  if (!host) return;
  let note = document.getElementById('progStartNote');
  if (!note){
    note = document.createElement('div');
    note.id = 'progStartNote';
    note.className = 'hint';
    note.style.marginTop = '6px';
    host.appendChild(note);
  }
  note.textContent = text;
}

// (First) simple clear of snap-hint text
function clearStartHint(){
  const hint = document.getElementById('snapHint');
  if (hint) hint.textContent = '';
}

// Current time as HH:MM
function nowHHMM(){
  var d=new Date();
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}

// Today as YYYY-MM-DD
function todayISO(){
  var d=new Date();
  return d.toISOString().slice(0,10);
}

// totalSec → "MM:SS"
function fmtMMSS(totalSec){
  var s=Math.max(0,Math.round(totalSec));
  var m=Math.floor(s/60), r=s%60;
  return String(m).padStart(2,'0')+':'+String(r).padStart(2,'0');
}

// Pad integer to 2 digits
function pad2(n){return String(n).padStart(2,'0');}

// minutes → "HH:MM"
function minutesToHHMM(x){
  const h=Math.floor(x/60), m=x%60;
  return pad2(h)+':'+pad2(m);
}

// Safe parseInt wrapper
function toInt(s){
  const n=parseInt(s||'0',10);
  return isNaN(n)?0:n;
}

// --- Weekly helpers (Sun–Sat) ---
// ISO "YYYY-MM-DD" → Date (noon, to avoid TZ issues)
function isoToDate(iso){
  const d = new Date((iso||'') + 'T12:00:00'); // noon avoids TZ bleed
  return isNaN(d) ? null : d;
}

// Date → "YYYY-MM-DD"
function dateToISO(d){ return d.toISOString().slice(0,10); }

// Short friendly label (first 10 chars of toDateString)
function fmtShort(d){ return d.toDateString().slice(0,10); } // e.g., 'Sun Oct 26'

// Given a date, return Sun–Sat ISO bounds for that week
function weekBoundsFor(dateIso){
  const d = isoToDate(dateIso) || new Date();
  const base = new Date(d); base.setHours(12,0,0,0);
  const dow = base.getDay();            // 0 = Sun
  const sun = new Date(base); sun.setDate(base.getDate() - dow);
  const sat = new Date(sun);  sat.setDate(sun.getDate() + 6);
  return { startISO: dateToISO(sun), endISO: dateToISO(sat), startDate: sun, endDate: sat };
}

// ISO date in [aISO, bISO]?
function inRange(iso, aISO, bISO){ return iso >= aISO && iso <= bISO; }

// GPS-style ETA: smooth input rate (rolling avg) + blend output ETA
function calcStableETA(leftUnits, rateNowUh){
  if (!rateNowUh || rateNowUh <= 0 || !isFinite(rateNowUh)) return null;

  // keep last 5 readings
  etaSmooth.push(rateNowUh);
  if (etaSmooth.length > 5) etaSmooth.shift();
  const avgRate = etaSmooth.reduce((a,b)=>a+b,0) / etaSmooth.length;

  const newETAmin = (leftUnits / avgRate) * 60;       // raw ETA (mins)
  const blended   = (lastETAmin == null)
      ? newETAmin
      : (lastETAmin * 0.8 + newETAmin * 0.2);         // 80/20 damping

  lastETAmin = blended;
  return blended;
}

// Interval for the Elapsed modal live update
let elapsedModalTick = null;

// Active minutes on current order (excluding in-order breaks)
function orderActiveMinutes() {
  if (!current || !current.start) return 0;

  const startMin = hhmmToMinutes(current.start);
  const nowMin   = hhmmToMinutes(nowHHMM());
  let active     = Math.max(0, nowMin - startMin);

  // subtract only in-order breaks (running or completed)
  for (const b of current.breaks || []) {
    const bStart = hhmmToMinutes(b.start);
    const bEnd   = b.end ? hhmmToMinutes(b.end) : nowMin;
    active -= Math.max(0, bEnd - bStart);
  }
  return Math.max(0, active);
}

// Reset the "New Order" form to its pristine state
function resetNewOrderForm() {
  const sel = document.getElementById('oCust');
  if (sel) {
    sel.value = '';
    // if you use the custom dropdown button, reset its label too
    const ddBtn = document.querySelector('#oDD .dd-toggle');
    if (ddBtn) ddBtn.textContent = 'Select customer…';
  }
  const other = document.getElementById('oOther');
  if (other) { other.value = ''; other.classList.add('hidden'); }

  const total = document.getElementById('oTotal');
  if (total) total.value = '';

  const btnStart = document.getElementById('btnStart');
  if (btnStart) { btnStart.disabled = true; btnStart.style.display = ''; }
}

// Live rate for current order (units/hour) using orderActiveMinutes()
function orderLiveRate() {
  const total = current?.total ?? 0;
  const lastLeft = (tempWraps.length ? tempWraps[tempWraps.length - 1].left : total);
  const done = total - lastLeft;
  const mins = orderActiveMinutes();
  if (mins <= 0) return 0;
  return (done / mins) * 60;
}

// Tint progress bar by pace band (bad/warn/ok)
function tintProgressByPace(rateUh){
  const fill = document.getElementById('progFill');
  if (!fill) return;

  // Resolve a robust pace
  let r = Math.round(Number(rateUh || 0));
  if (r <= 0) {
    r = Math.round(
      (predictive?.rateUh) ||
      (typeof orderLiveRate === 'function' && orderLiveRate()) ||
      (typeof getLiveRateUh  === 'function' && getLiveRateUh()) ||
      uiLastPaceUh || 280
    );
  }

  // Remember last good pace
  if (r > 0) uiLastPaceUh = r;

  // Class bands: <249 red, 249–299 amber, 300+ green
  let cls = 'pace-bad';
  if (r >= 300) cls = 'pace-ok';
  else if (r >= 249) cls = 'pace-warn';

  fill.classList.remove('pace-ok','pace-warn','pace-bad');
  fill.classList.add(cls);
}

// Put the lateness note on the same row as the "Log / Delay" button (right side)
function showPreOrderNote(text){
  const delayBtn = document.getElementById('btnDelay');
  if (!delayBtn || !delayBtn.parentElement) return;

  // If ensureActionRowLayout has run, delayBtn is in #actionsRight.
  // We want the note in the LEFT group, flush-left.
  let container = delayBtn.parentElement;           // likely #actionsRight
  if (container.id === 'actionsRight' && container.parentElement){
    container = container.parentElement;            // the row wrapper
  }

  // Ensure groups exist
  let left  = document.getElementById('actionsLeft');
  let right = document.getElementById('actionsRight');
  if (!left){
    left = document.createElement('div');
    left.id = 'actionsLeft';
    container.insertBefore(left, container.firstChild);
  }
  if (!right){
    right = document.createElement('div');
    right.id = 'actionsRight';
    container.appendChild(right);
  }

  // Layout the row
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'space-between';
  container.style.gap = '12px';
  left.style.display  = 'flex';
  left.style.alignItems = 'center';
  left.style.gap      = '10px';
  right.style.display = 'flex';
  right.style.gap     = '10px';

  // Create/replace the note in LEFT group (first position)
  let note = document.getElementById('contractNote');
  if (!note){
    note = document.createElement('div');
    note.id = 'contractNote';
    note.className = 'hint';
  }
  note.textContent = text;

  if (note.parentElement !== left){
    left.insertBefore(note, left.firstChild || null);
  }
}

// Clear both the old start-hint and this pre-order note
// NOTE: second definition of clearStartHint (overwrites earlier one)
function clearStartHint(){
  const hint = document.getElementById('snapHint');
  if (hint) hint.textContent = '';
  const cn = document.getElementById('contractNote');
  if (cn && cn.parentNode) cn.parentNode.removeChild(cn);
}

// Minutes → "Xh Ym" / "Ym" style ETA string
function formatETA(mins){
  if (!isFinite(mins) || mins <= 0) return '—';
  const h = Math.floor(mins/60);
  const m = Math.round(mins%60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Main progress header updater (non-predictive mode)
function updateProgressHeader() {
  const wrapOpen = document.getElementById('wrapModal')?.style.display === 'flex';
  if (wrapOpen) return;
  if (!current) return;
  if (predictive && predictive.timer) return;
  const total   = current.total;
  const lastLeft = getCurrentLeft();

  // Calculate progress (done units)
  const done = total - lastLeft;
  const pct  = total ? Math.round((done / total) * 100) : 0;

  // Update numbers ...
  updateLeftLabel(lastLeft);                    // ← single writer
  const elPal = document.getElementById('progPallets');
  const elPct = document.getElementById('progPct');

  if (elPal) elPal.textContent = tempWraps.length; // Update pallet count
  if (elPct) elPct.textContent = pct + '%'; // Update progress %

  // Update the progress bar width based on progress
  const fill = document.getElementById('progFill');
  if (fill) fill.style.width = pct + '%';

  // Rate display from frozen sources only
  const rEl = document.getElementById('progRate');
  const eEl = document.getElementById('progETA');

  const displayRate = current.orderRateUh ?? current.preWrapRateUh ?? 0;
  if (rEl) rEl.textContent = displayRate ? `${displayRate} u/h` : '—';

  // ETA is frozen until Log Wrap, shared mode will inherit it
  if (eEl) eEl.textContent = current.fixedETA || '—';

  // Keep tint logic for color bands based on frozen rate
  tintProgressByPace(displayRate);
  updateHeaderActions?.();
}

// Switch header from New Order → Progress view and seed defaults
function showProgressHeader() {
  if (!current) return;
  const predictiveActive = !!(predictive && predictive.timer);
  const form = document.getElementById('orderHeaderForm');
  const prog = document.getElementById('orderHeaderProgress');
  if (form) form.style.display = 'none';
  if (prog) prog.style.display = 'flex';

  // Seed static bits
  document.getElementById('progCust').textContent    = current.name;
  document.getElementById('progQty').textContent     = current.total;
  document.getElementById('progPallets').textContent = '0';
  updateLeftLabel(getCurrentLeft());
  document.getElementById('progRate').textContent    = '—';
  document.getElementById('progETA').textContent     = '—';
  document.getElementById('progFill').style.width    = '0%';
  document.getElementById('progPct').textContent     = '0%';

  // NEW: reset ETA smoother when entering progress view (GPS-style fresh start)
  window.etaSmooth = [];
  window.lastETAmin = null;
  window.lastRenderedETAmin = null;

  updateProgressHeader();
  updateHeaderActions?.();
}

/* Utility: add minutes to now → HH:MM */
function addMinutesToNow(mins){
  const d = new Date();
  d.setMinutes(d.getMinutes() + Math.max(0, Math.round(mins)));
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* Toggle clickability/visual state of the Elapsed chip */
function setElapsedChipClickable(on){
  const chipBox = document.getElementById('chipElapsed');
  if(!chipBox) return;
  chipBox.classList.toggle('disabled', !on);
}

/* Open only when an order is running and not on break */
function openElapsedModal(){
  if (!current || breakDraft) return;
  const m = document.getElementById('elapsedModal');
  if(!m) return;
  m.style.display = 'flex';
  renderElapsedModalOnce();
  if (elapsedModalTick) clearInterval(elapsedModalTick);
  elapsedModalTick = setInterval(renderElapsedModalOnce, 600);
}

/* Close & cleanup */
function closeElapsedModal(){
  const m = document.getElementById('elapsedModal');
  if(!m) return;
  m.style.display = 'none';
  if (elapsedModalTick) { clearInterval(elapsedModalTick); elapsedModalTick = null; }
}

/* One-frame render based on live snapshot + current order */
function renderElapsedModalOnce(){
  if (!current){ closeElapsedModal(); return; }

  // Progress on the active order
  const doneNow = currentOrderUnitsDone();
  const total   = current.total || 0;
  const remainingUnits = Math.max(0, total - doneNow);

  // Elapsed ACTIVE minutes (exclude breaks if available)
  let elapsedMin;
  try {
    if (typeof orderActiveMinutes === 'function') {
      elapsedMin = orderActiveMinutes() || 0;
    } else {
      // Fallback: naive elapsed minus any available break accumulator
      const now = nowHHMM();
      const naive = Math.max(0, Math.round((hm(now) - hm(current.start)) * 60));
      const brMin = (typeof getBreakMinutesSinceOrderStart === 'function') ? (getBreakMinutesSinceOrderStart() || 0) : 0;
      elapsedMin = Math.max(0, naive - brMin);
    }
  } catch(e){
    // Last-resort fallback
    const now = nowHHMM();
    elapsedMin = Math.max(0, Math.round((hm(now) - hm(current.start)) * 60));
  }

  // Current ORDER rate (u/h) from active minutes
  let orderRate = 0;
  if (elapsedMin > 0) {
    orderRate = (doneNow / (elapsedMin / 60));
  }

  // Time left & ETA using the same smoothing + break extension as header
  let minsLeft = null;
  let etaStr = '—';
  if (orderRate > 0 && remainingUnits > 0){
    let estMin;
    try {
      if (typeof calcStableETA === 'function') {
        estMin = calcStableETA(remainingUnits, orderRate);
      }
    } catch(e){
      estMin = undefined;
    }
    if (!isFinite(estMin)) {
      estMin = (remainingUnits / orderRate) * 60;
    }
    const breakExt = (typeof breakExtensionMinutes === 'function') ? (breakExtensionMinutes() || 0) : 0;
    minsLeft = Math.max(0, Math.round(estMin + breakExt));
    etaStr   = addMinutesToNow(minsLeft);
  }

  const setTxt = (id, txt)=>{ const el=document.getElementById(id); if(el) el.textContent = txt; };
  setTxt('el_start', current.start || '—');
  setTxt('el_elapsed', `${Math.floor(elapsedMin/60)}h ${String(elapsedMin%60).padStart(2,'0')}m`);
  setTxt('el_remaining', String(remainingUnits));
  setTxt('el_rate', (orderRate > 0) ? `${Math.round(orderRate)} u/h` : '—');
  setTxt('el_timeleft', (minsLeft===null) ? '—' : `${Math.floor(minsLeft/60)}h ${String(minsLeft%60).padStart(2,'0')}m`);
  setTxt('el_eta', etaStr);
}

// Tiny beep helper (used for break timer etc.)
function tryBeep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    o.start();
    setTimeout(()=>{
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.02);
      o.stop();
      ctx.close();
    }, 350);
  }catch(e){ /* no-op */ }
}

// ====== Persistence ======

// Main load: everything from localStorage → in-memory state
function loadAll(){
  try {
    const raw = localStorage.getItem(KEY);

    if (raw) {
      const p = JSON.parse(raw);
      picks       = Array.isArray(p.picks) ? p.picks : [];
      historyDays = Array.isArray(p.history) ? p.history : [];
      current     = p.current || null;
      tempWraps   = Array.isArray(p.tempWraps) ? p.tempWraps : [];
      startTime   = (typeof p.startTime === 'string') ? p.startTime : "";
      lastClose   = (typeof p.lastClose === 'string') ? p.lastClose : "";
      undoStack   = Array.isArray(p.undoStack) ? p.undoStack : [];
      pickingCutoff = (typeof p.pickingCutoff === 'string') ? p.pickingCutoff : "";
      proUnlocked = !!p.proUnlocked;
      snakeUnlocked = !!p.snakeUnlocked;
      shiftBreaks = Array.isArray(p.shiftBreaks) ? p.shiftBreaks : [];

      // ── Operative data (new) ───────────────────────────────
      operativeLog    = Array.isArray(p.operativeLog) ? p.operativeLog : [];
      operativeActive = p.operativeActive || null;
      refreshOperativeChip();
    } else {
      // ── Sane defaults on first run / cleared storage ───────
      picks = []; historyDays = []; current = null; tempWraps = [];
      startTime = ""; lastClose = ""; pickingCutoff = ""; undoStack = [];
      proUnlocked = false; snakeUnlocked = false; shiftBreaks = [];

      // ── Operative defaults (new) ───────────────────────────
      operativeLog = [];
      operativeActive = null;
    }

    // learned UL
    const lraw = localStorage.getItem(KEY_LEARN);
    learnedUL = lraw ? (JSON.parse(lraw) || {}) : {};

    // load persisted break draft (UI restore is done later)
    try {
      const braw = localStorage.getItem('breakDraft');
      breakDraft = braw ? (JSON.parse(braw) || null) : null;
    } catch(e){ breakDraft = null; }

  } catch (e) {
    console.error(e);
    // ── Hard reset if corrupted ──────────────────────────────
    picks = []; historyDays = []; current = null; tempWraps = [];
    startTime = ""; lastClose = ""; pickingCutoff = ""; undoStack = [];
    proUnlocked = false; shiftBreaks = []; learnedUL = {};
    breakDraft = null;

    // ── Operative defaults on error (new) ────────────────────
    operativeLog = [];
    operativeActive = null;
  }
}

// Main save: in-memory state → localStorage
function saveAll(){
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: '3.3.55',               // keep existing schema tag
        savedAt: new Date().toISOString(),
        picks,
        history: historyDays,
        current,
        tempWraps,
        startTime,
        lastClose,
        pickingCutoff,
        undoStack,
        proUnlocked,
        snakeUnlocked,
        shiftBreaks,
        operativeLog,
        operativeActive
      })
    );
    localStorage.setItem(KEY_LEARN, JSON.stringify(learnedUL || {}));
  } catch (e) {
    console.error(e);
  }
}

// Custom codes
function loadCustomCodes(){
  try{
    var raw=localStorage.getItem(KEY_CODES);
    if(raw){
      customCodes=JSON.parse(raw)||[];
    }
  }catch(e){
    customCodes=[];
  }
}
function saveCustomCodes(){
  try{
    localStorage.setItem(KEY_CODES, JSON.stringify(customCodes||[]));
  }catch(e){}
}

// ====== Grouped dropdowns ======

// Built-in default store codes
const DEFAULT_CODES = [
  'ASDAVO','ASDERI','ASDFAL','ASDLUT','ASDWAS',
  'BOOHAY',
  'COOAVO','COOLEA','COOWEL','COOWES',
  'MORNOR','MORWAK',
  'OCAPUR',
  'SAIEME','SAINOR','SAITHA',
  'TESDID','TESWIN',
  'WAILEY'
];

// Normalize -> [A-Z]{0,6}
function upcase6(s){ return (s||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,6); }

// Valid code = exactly 6 letters
function isValidCode(s){ return /^[A-Z]{6}$/.test(s||''); }

// First 3 letters for grouping
function prefix3(code){ return (code||'').slice(0,3).toUpperCase(); }

// Group codes by first 3 letters and sort
function groupedMap(all){
  const map={};
  all.forEach(c=>{
    const p=prefix3(c);
    (map[p]=map[p]||[]).push(c);
  });
  Object.keys(map).forEach(k=>map[k].sort());
  return Object.fromEntries(Object.entries(map).sort(([a],[b])=>a.localeCompare(b)));
}

// Build the custom grouped dropdown component (main + Other…)
function buildDropdown(ddId, selectId, otherInputId, prefix){
  const sel = document.getElementById(selectId);
  const dd  = document.getElementById(ddId);
  const menu = dd.querySelector('.dd-menu');
  const btn = dd.querySelector('.dd-toggle');
  const otherInput = document.getElementById(otherInputId);

  function setValue(val){
    sel.value = val;
    btn.textContent = val==='__OTHER__' ? 'Other…' : val;
    onCustomerChange(prefix);
    if(prefix==='o') refreshStartButton();
    saveAll();
    dd.classList.remove('open');
  }

  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('.dd.open').forEach(x=>{ if(x!==dd) x.classList.remove('open'); });
    dd.classList.toggle('open');
    if(dd.classList.contains('open')) { menu.scrollTop = 0; }
  });

  document.addEventListener('click', (e)=>{
    if(!dd.contains(e.target)) dd.classList.remove('open');
  });

  function render(){
    const uniq = Array.from(new Set([...(DEFAULT_CODES||[]), ...(customCodes||[])]));
    const groups = groupedMap(uniq);

    menu.innerHTML = '';

    Object.entries(groups).forEach(([pref, codes])=>{
      const group = document.createElement('div');
      group.className = 'dd-group';

      const h = document.createElement('h4');
      h.innerHTML = `${pref}<span>▾</span>`;
      const items = document.createElement('div');
      items.className = 'dd-items';

      codes.forEach(code=>{
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = code;
        b.addEventListener('click', ()=> setValue(code));
        items.appendChild(b);
      });

      h.addEventListener('click', ()=> {
        items.style.display = (items.style.display === 'block') ? 'none' : 'block';
      });

      group.appendChild(h);
      group.appendChild(items);
      menu.appendChild(group);
    });

    const other = document.createElement('div');
    other.className = 'dd-other';
    const btnOther = document.createElement('button');
    btnOther.type = 'button';
    btnOther.textContent = 'Other…';
    btnOther.addEventListener('click', ()=>{
      setValue('__OTHER__');
      otherInput?.classList.remove('hidden');
      otherInput?.focus();
    });
    other.appendChild(btnOther);
    menu.appendChild(other);
  }

  render();
  btn.textContent = sel.value
    ? (sel.value==='__OTHER__' ? 'Other…' : sel.value)
    : 'Select customer…';
  dd.__reload = render;
}
// Rebuild <select> and custom dropdown after codes change
function reloadDropdowns(){
  const uniq = Array.from(new Set([...(DEFAULT_CODES||[]), ...(customCodes||[])]));
  const oSel  = document.getElementById('oCust');
  if (oSel) {
    oSel.innerHTML = '';
    uniq.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      oSel.appendChild(o);
    });
    const other = document.createElement('option');
    other.value = '__OTHER__'; other.textContent = 'Other…';
    oSel.appendChild(other);
  }
  document.getElementById('oDD')?.__reload?.();
}

// Handle main customer dropdown change (and show/hide "Other" input)
function onCustomerChange(prefix){
  const sel   = document.getElementById('oCust');
  const input = document.getElementById('oOther');
  if(!sel || !input) return;
  if(sel.value==='__OTHER__'){ input.classList.remove('hidden'); input.focus(); }
  else { input.classList.add('hidden'); }
  if(prefix==='o') refreshStartButton();
  renderULayerChips();
  saveAll();
}

// Handle typing in Other… input; auto-promote to custom code if valid
function onOtherInput(prefix){
  const sel   = document.getElementById('oCust');
  const input = document.getElementById('oOther');
  const dd    = document.getElementById('oDD');
  if(!sel || !input) return;
  const before = input.value;
  input.value = upcase6(input.value);
  if(before!==input.value && prefix==='o') refreshStartButton();
  const code = input.value;
  if(isValidCode(code)){
    if(customCodes.indexOf(code)===-1){
      customCodes.push(code); saveCustomCodes();
    }
    reloadDropdowns();
    sel.value = code;
    input.classList.add('hidden');
    if(dd && dd.querySelector('.dd-toggle')) dd.querySelector('.dd-toggle').textContent = code;
    if(prefix==='o') refreshStartButton();
    showToast('Added '+code);
    renderULayerChips();
    saveAll();
  }
}

// ====== Gates ======

// Show/hide Snake-only UI based on gate flag
function applySnakeGate(){
  document.querySelectorAll('.gate-snake').forEach(el => {
    // Force-show when unlocked, otherwise hide
    el.style.display = snakeUnlocked ? 'inline-block' : 'none';
  });
}

// Show/hide Pro-only UI based on gate flag (plus history exceptions)
function applyProGate(){
  document.querySelectorAll('.gate-pro').forEach(el => {
    const inHistory = !!el.closest('#tabHistory');
    el.style.display = (proUnlocked && !inHistory) ? 'inline-block' : 'none';
  });
  applySnakeGate();
  saveAll();
}

// QC rate input gate: detect secret codes (Pro, Snake, Operative)
function updCalcGate() {
  const inp = document.getElementById('qcRate');
  if (!inp) return;

  const raw    = String(inp.value || '');
  const digits = raw.replace(/\D+/g, '');

  // ---- Pro tools unlock ------------------------------------
  if (digits.endsWith(PRO_UNLOCK_CODE) && digits.length >= PRO_UNLOCK_CODE.length) {
    inp.value = '';
    try { localStorage.setItem('proUnlocked','1'); } catch {}
    window.proUnlocked = true;
    showToast('Pro tools unlocked');
    openProSettingsModal?.();
    return;
  }

  // ---- Snake unlock ----------------------------------------
  if (digits.endsWith(SNAKE_UNLOCK_CODE) && digits.length >= SNAKE_UNLOCK_CODE.length) {
    inp.value = '';
    snakeUnlocked = true;
    applySnakeGate();
    saveAll();
    showToast('Snake available');
    return;
  }

  // ---- Operative unlock ------------------------------------
  if (digits.endsWith(OPER_UNLOCK_CODE) && digits.length >= OPER_UNLOCK_CODE.length) {
    inp.value = '';
    if (!startTime) {
      showToast('Start your shift first');
      // openContractedStartPicker?.();  // optional
      return;
    }
    openOperativeModal();
    return;
  }

  // No special code → just re-run normal QuickCalc logic
  updCalc?.();
}

// ====== Tabs ======

// Generic tab switcher for Calc / Tracker / History
function showTab(which){
  // ---------- swap visible section ----------
  const id = 'tab' + which.charAt(0).toUpperCase() + which.slice(1);
  ['tabCalc','tabTracker','tabHistory'].forEach(x =>
    document.getElementById(x).classList.toggle('hidden', x !== id)
  );

  // ---------- tab button active state ----------
  ['tabCalcBtn','tabTrackBtn','tabHistBtn'].forEach(x =>
    document.getElementById(x).classList.remove('active')
  );
  if (which === 'calc')    document.getElementById('tabCalcBtn').classList.add('active');
  if (which === 'tracker') document.getElementById('tabTrackBtn').classList.add('active');
  if (which === 'history') document.getElementById('tabHistBtn').classList.add('active');

  // Live banner: only on Tracker *and* only once a shift has started
  const lb = document.getElementById('liveBanner');
  const hasShift = !!startTime;   // startTime is set when the shift begins / is restored
  if (lb) lb.classList.toggle('hidden', which !== 'tracker' || !hasShift);

  // convenience handles
  const form = document.getElementById('orderHeaderForm');
  const prog = document.getElementById('orderHeaderProgress');
  const area = document.getElementById('orderArea');

  // ---------- HISTORY TAB ----------
  if (which === 'history') {
    renderWeeklySummary();
    initWeekCardToggle();
    // hide order-area when on history
    if (area) area.style.display = 'none';
    return;
  }

  // ---------- TRACKER TAB ----------
  if (which === 'tracker') {
    // Stronger check than !!window.current
    const inOrder = !!(current && Number.isFinite(current.total));

    // Normalize header state (no animation here – just correct display)
    if (inOrder) {
      if (form) { form.style.display = 'none'; form.classList.add('fade'); form.classList.remove('show'); }
      if (prog) { prog.style.display = 'flex'; prog.classList.add('fade','show'); }
      if (area) area.style.display = 'block';
    } else {
      if (prog) { prog.style.display = 'none'; prog.classList.add('fade'); prog.classList.remove('show'); }
      if (form) { form.style.display = 'block'; form.classList.add('fade','show'); }
      if (area) area.style.display = 'none';
    }

    // Gate bottom controls by active order
    ['btnDelay','btnUndo','btnB','btnL','btnCloseEarly'].forEach(id=>{
      const el = document.getElementById(id);
      if (el) el.style.display = inOrder ? 'inline-block' : 'none';
    });

    // Keep header/controls accurate
    updateProgressHeader?.();
    updateDelayBtn?.();
    updateEndShiftVisibility?.();
    updateEndPickingVisibility?.();
    updateCloseEarlyVisibility?.();
    renderShiftPanel?.();
    saveAll();
    return;
  }

  // ---------- CALC TAB ----------
  ['btnDelay','btnUndo','btnB','btnL','btnCloseEarly'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  saveAll();
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
  updateDelayBtn?.();
  updateEndShiftVisibility?.();
  updateEndShiftVisibility?.();
  updateCloseEarlyVisibility?.();

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
function applyContractedStart(hh){
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
  const hasCust = sel.value && sel.value!=='__OTHER__' ||
                  (sel.value==='__OTHER__' && /^[A-Z]{6}$/.test((other.value||'').toUpperCase()));
  const ok = hasCust && total>0;

  const btn = document.getElementById('btnStart');
  if (btn) btn.disabled = !ok;

  // NEW: mirror state to Shared Pick
  const sharedBtn = document.getElementById('btnSharedStart');
  if (sharedBtn) sharedBtn.disabled = !ok;
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
    show('btnB',           true);
    show('btnL',           true);
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
    show('btnB',            false);
    show('btnL',            false);
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
  const total = parseInt((document.getElementById('oTotal').value || '0'), 10);

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
  if (!(total > 0)) return alert('Enter total units');

  const finalName = isOther ? otherVal : name;

  // create order state
  current = {
    name: finalName,
    total,
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

  // Reset the safety ghost button back to "Clear today's data"
  (function resetSafetyButton(){
    const btn = document.querySelector('.safetybar button.btn.ghost');
    if (!btn) return;
    btn.textContent = "Clear today's data";
    btn.onclick = function(){ clearToday?.(); };
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

  const t = nowHHMM();
  tempWraps.push({ left, done, t });
  undoStack.push({ type: 'wrap' });

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

  // Buttons/complete state
  updateHeaderActions?.();

  // ✅ Auto-close when 0 left
  if (left === 0) {
    showToast?.('Order complete — closing...');
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
    tempWraps.push({ left: 0, done: lastLeft, t: closeHHMM });
    undoStack.push({ type: 'wrap' });
  }

  const palletsCount = tempWraps.length || 1;
  const unitsDone    = total;
  const exclMins     = (current.breaks || []).reduce((a,b)=>a+(b.minutes||0),0);

  // Archive into picks
  const archived = {
    name:    current.name,
    units:   unitsDone,
    pallets: palletsCount,
    start:   current.start,
    close:   closeHHMM,
    excl:    exclMins,
    log:     { wraps: tempWraps.slice(), breaks: (current.breaks || []).slice() }
  };
  picks.push(archived);
  lastClose = closeHHMM;

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
  if (typeof updateDelayBtn === 'function') updateDelayBtn();
  if (typeof updateEndShiftVisibility === 'function') updateEndShiftVisibility();
  if (typeof updateCloseEarlyVisibility === 'function') updateCloseEarlyVisibility();

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
  showToast?.(`Delay logged (${minutes}m)`);
}

// Auto-log a congestion delay when returning from the Snake game
function applySnakeDelayIfAny(){
  try {
    const doneRaw  = localStorage.getItem('snakeDelayCompleted');
    if (!doneRaw) return;

    const draftRaw = localStorage.getItem('snakeDelayDraft');
    let done  = null;
    let draft = null;

    try { done  = JSON.parse(doneRaw || 'null') || null; } catch(_){ done = null; }
    try { draft = draftRaw ? (JSON.parse(draftRaw) || null) : null; } catch(_){ draft = null; }

    // Determine start/end HH:MM
    let start = (draft && typeof draft.start === 'string') ? draft.start : null;
    let end   = (done  && typeof done.end   === 'string') ? done.end   : nowHHMM();
    const cause = (done && typeof done.cause === 'string') ? done.cause : 'Congestion';

    if (!start) start = end;

    let minutes = Math.max(1, Math.round((hm(end) - hm(start)) * 60));
    if (!Number.isFinite(minutes) || minutes <= 0) minutes = 1;

    if (window.current && Number.isFinite(window.current.total)) {
      window.current.breaks = window.current.breaks || [];
      const entry = { type:'D', start, end, minutes, cause };
      window.current.breaks.push(entry);
      window.current.__lastDelay = entry;
      window.undoStack?.push?.({ type:'delay' });
      window.renderTimeline?.();
      window.updateSummary?.();
      window.saveAll?.();
    } else {
      const key = 'shiftDelays';
      let arr = [];
      try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch(_){ arr = []; }
      arr.push({ type:'D', start, end, minutes, cause });
      localStorage.setItem(key, JSON.stringify(arr));
      window.renderShiftPanel?.();
    }

    // Best-effort cleanup so we don't accidentally re-log
    localStorage.removeItem('snakeDelayDraft');
    localStorage.removeItem('snakeDelayCompleted');
  } catch (e) {
    console.error('applySnakeDelayIfAny failed', e);
    try {
      localStorage.removeItem('snakeDelayDraft');
      localStorage.removeItem('snakeDelayCompleted');
    } catch(_){}
  }
}

// Launch Snake from an active break/lunch
function openSnakeFromBreak(){
  if (!snakeUnlocked) {
    showToast?.('Enter the Snake code first');
    return;
  }

  if (!breakDraft) {
    showToast?.('Snake is only available during an active break or lunch.');
    return;
  }

  // Reuse the same maths as tickBreak to enforce “no minus-time Snake”
  const now       = nowHHMM();
  const elapsedMin = Math.round((hm(now) - hm(breakDraft.startHHMM)) * 60);
  const targetMin  = Math.round((breakDraft.targetSec || 0) / 60);
  const diff       = targetMin - elapsedMin;

  if (diff < 0) {
    showToast?.('Snake only while the timer is positive – your break is already over.');
    return;
  }

  const host = document.getElementById('snakeHostModal');
  if (!host) return;

  // Show modal
  host.classList.remove('hidden');
  host.style.display = 'flex';

  // Ensure the iframe is loaded
  const iframe = document.getElementById('snakeFrame');
  if (iframe && !iframe.src) {
    iframe.src = 'snake.html';
  }

  // Adjust title & hint to match break/lunch context
  const titleEl = document.getElementById('snakeHostTitle');
  if (titleEl) {
    titleEl.textContent = (breakDraft.type === 'L' ? 'Lunch Snake' : 'Break Snake');
  }

  const hintEl = host.querySelector('.hint');
  if (hintEl) {
    hintEl.textContent = 'Play during break or lunch only. Snake is a Pro tool and stays hidden unless unlocked.';
  }
}

// Legacy name kept so any old calls don’t explode – now just routes to the break behaviour
function openSnakeFromDelay(){
  openSnakeFromBreak();
}

// Close the embedded Snake host modal (iframe sandbox)
function closeSnakeHost(){
  const host = document.getElementById('snakeHostModal');
  if (!host) return;

  // Work with both CSS class + inline style hiding
  host.classList.add('hidden');
  host.style.display = 'none';

  // Clear iframe src so the game fully resets next time
  const iframe = document.getElementById('snakeFrame');
  if (iframe) iframe.src = '';
}

// Launch Snake from a logged delay, snapshotting context for auto-delay logging
function openSnakeFromDelay(){
  if (!snakeUnlocked) {
    showToast?.('Enter the Snake code first');
    return;
  }

  try {
    // 1) Snapshot delay start + whether there's an active order
    const start    = (window.delayDraft && delayDraft.start) ? delayDraft.start : nowHHMM();
    const hasOrder = !!(window.current && Number.isFinite(window.current.total));
    const payload  = { start, hasOrder };
    localStorage.setItem('snakeDelayDraft', JSON.stringify(payload));

    // 2) Snapshot the live rate for Snake difficulty seeding
    let rateUh = 0;

    // Prefer the helper (true per-order or shift live rate)
    if (typeof getLiveRateUh === 'function') {
      rateUh = Math.round(getLiveRateUh() || 0);
    } else {
      // Fallback: parse the Live Rate chip text, e.g. "283 u/h"
      const chip = document.getElementById('chipRateVal');
      if (chip) {
        const m = String(chip.textContent || '').match(/(\d+)/);
        rateUh = m ? parseInt(m[1], 10) : 0;
      }
    }

    // If there's nothing meaningful, default to 250 u/h
    if (!rateUh || rateUh <= 0 || !Number.isFinite(rateUh)) {
      rateUh = 250;
    }

    localStorage.setItem('snakeLiveRateUh', String(rateUh));
  } catch(e){
    console.error('openSnakeFromDelay snapshot failed', e);
  }

  // 3) Navigate to Snake as a full page
  window.location.href = 'snake.html';
}

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
  // Enable Snake only while timer is positive and we’re on break
  const snakeBtn = document.getElementById('btnSnakeBreak');
  if (snakeBtn) {
    const allow = diff >= 0 && !!breakDraft;
    snakeBtn.disabled = !allow;
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
  if (typeof updateCloseEarlyBtn === 'function') updateCloseEarlyBtn();
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
      tempWraps.push({ left: remaining, done: prevLeft - remaining, t: nowHHMM() });
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

  picks.push({
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
  });
  lastClose = closeHHMM;

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
    var excl = (o.log && Array.isArray(o.log.breaks))
      ? o.log.breaks.reduce((a,b)=>a+(b.minutes||0),0)
      : (o.excl || 0);
    var net  = (e > s) ? (e - s) - (excl)/60 : 0.01;
    var rate = Math.round(o.units / Math.max(0.01, net));

    var tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.dataset.idx = i;
    tr.innerHTML =
      '<td>'+(i+1)+'</td>'+
      '<td>'+o.name+'</td>'+
      '<td>'+o.units+'</td>'+
      '<td>'+o.pallets+'</td>'+
      '<td>'+o.start+'</td>'+
      '<td>'+o.close+'</td>'+
      '<td>'+rate+' u/h</td>';
    tb.appendChild(tr);

    // Expandable log row
    var logTr = document.createElement('tr');
    logTr.className = 'logrow';
    logTr.id = 'logrow_'+i;

    var logTd = document.createElement('td');
    logTd.colSpan = 7;

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

    if (o.earlyReason && o.earlyReason.trim().length > 0) {
      html += `<div class="tick"><span>📝 Early Close Reason:</span>` +
              `<span class="meta">${o.earlyReason.replace(/</g,'&lt;')}</span></div>`;
    }

    html += '</div>';
    logTd.innerHTML = html;
    logTr.appendChild(logTd);
    tb.appendChild(logTr);

    // Row toggle
    tr.addEventListener('click', function(){
      var row = document.getElementById('logrow_'+i);
      if (!row) return;
      row.style.display = (row.style.display === 'table-row') ? 'none' : 'table-row';
    });
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
  let totalWorkedFlooredMin = 0;  // all worked time, floored to 15m
  let daysCount  = 0;

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
    daysCount  += 1;
  }

  // Weekly split: only minutes beyond 45h count as 'paid overtime'
  const paidOTMin = Math.max(0, totalWorkedFlooredMin - WEEK_OT_THRESHOLD_MIN);
  const nonOTMin  = totalWorkedFlooredMin - paidOTMin;

  // Tiles
  const totalHoursAll   = totalWorkedFlooredMin / 60;        // for weighted avg denominator
  const totalHoursTile  = (nonOTMin / 60).toFixed(2);        // non-OT hours only
  const overtimeTile    = (paidOTMin / 60).toFixed(2) + ' h';// paid OT only
  const weighted        = (totalHoursAll > 0) ? Math.round(totalUnits / totalHoursAll) : 0;

  document.getElementById('weekUnits')    ?.replaceChildren(document.createTextNode(String(totalUnits)));
  document.getElementById('weekDays')     ?.replaceChildren(document.createTextNode(String(daysCount)));
  document.getElementById('weekHours')    ?.replaceChildren(document.createTextNode(totalHoursTile));
  document.getElementById('weekOvertime') ?.replaceChildren(document.createTextNode(overtimeTile));
  document.getElementById('weekWeighted') ?.replaceChildren(document.createTextNode(weighted + ' u/h'));

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

    // Day Avg based on ACTUAL worked hours (to the minute)
    const workedHours   = workedMin / 60;
    const dayAvgWorked  = (workedHours > 0)
      ? Math.round(((Number(d.totalUnits) || 0) / workedHours))
      : 0;
    const effectiveRate = (Number.isFinite(+d.dayRate) && +d.dayRate > 0)
      ? +d.dayRate
      : dayAvgWorked;

    const boxState = effectiveRate >= 300 ? 'ok'
                    : (effectiveRate >= 249 ? 'warn' : 'bad');
    head.className = 'accHead ' + boxState;

    // Header layout: date + meta row
    leftDiv.innerHTML =
      `<span class="tag">${new Date(d.date+'T12:00:00').toDateString().slice(0,15)}</span>
      <div class="meta-row">
        <span>Units: <b>${d.totalUnits || 0}</b></span>
        <span>Day Avg: <b>${dayAvgWorked}</b> u/h</span>
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
      '<thead><tr><th>#</th><th>Customer</th><th>Units</th><th>Pallets</th><th>Start</th><th>Closed</th><th>Order Rate</th></tr></thead>';
    var tbody = document.createElement('tbody');

    (d.picks || []).forEach(function(o,i){
      var s = hm(o.start), e = hm(o.close);
      var excl = (o.log && Array.isArray(o.log.breaks))
        ? o.log.breaks.reduce((a,b)=>a+(b.minutes||0),0)
        : (o.excl || 0);
      var net  = (e > s) ? (e - s) - (excl)/60 : 0.01;
      var rate = Math.round(o.units / Math.max(0.01, net));

      var tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.dataset.idx = i;
      tr.innerHTML =
        '<td>'+(i+1)+'</td>'+
        '<td>'+o.name+'</td>'+
        '<td>'+o.units+'</td>'+
        '<td>'+o.pallets+'</td>'+
        '<td>'+o.start+'</td>'+
        '<td>'+o.close+'</td>'+
        '<td>'+rate+' u/h</td>';

      var logTr = document.createElement('tr');
      logTr.className = 'logrow';
      logTr.id = 'hlog_'+di+'_'+i;

      var td = document.createElement('td');
      td.colSpan = 7;

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

// ====== End Shift button visibility (Tracker tab only) ======
function updateEndShiftVisibility(){
  const btn = document.getElementById('btnEndShift');
  if (!btn) return;

  const trackerTab = document.getElementById('tabTracker');
  const trackerVisible = trackerTab ? !trackerTab.classList.contains('hidden') : false;

  const show = trackerVisible && !current && picks.length > 0;
  btn.style.display = show ? 'inline-block' : 'none';
}
function updateEndPickingVisibility(){
  const btn = document.getElementById('btnEndPicking');
  if (!btn) return;

  const trackerTab = document.getElementById('tabTracker');
  const trackerVisible = trackerTab ? !trackerTab.classList.contains('hidden') : false;

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
  const show = trackerVisible && hasShift && !inOrder && !frozen && lateEnough;
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
function endShift(){
  if (current){
    return alert('Complete or undo the current order before ending the shift.');
  }
  if (!picks.length){
    return alert('No completed orders to archive.');
  }

  const dateStr = todayISO();

  // Shift length: null-safe
  const tLenEl = document.getElementById('tLen');
  const shiftLen = parseFloat(tLenEl?.value || '9');

  const totalUnits = picks.reduce((a,b)=> a + b.units, 0);
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
  const workedMin   = (startTime && endHHMM) ? Math.max(0, toMin(endHHMM) - toMin(startTime)) : 0;
  const scheduledMin= Math.round((shiftLen || 9) * 60);

  const snapshot = {
    date:        dateStr,
    start:       startTime || '',
    end:         endHHMM || '',
    shiftLen,
    totalUnits,
    dayRate:     shiftLen > 0 ? Math.round(totalUnits / shiftLen) : 0, // keep day avg by full shift
    picks:       picks.slice(0),
    shiftBreaks: shiftBreaks.slice(0),
    downtimes,
    operativeLog: (operativeLog || []).slice(0),
    // NEW fields used by weekly overtime calc
    workedMin,
    scheduledMin
  };

  historyDays.push(snapshot);
  saveAll();
  renderHistory();
  renderWeeklySummary();

  exitShiftNoArchive?.();  // reuse your existing full reset
  showTab?.('tracker');    // land back on the Tracker start screen
  showToast?.('Shift archived to History');
}

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

  // land on Tracker
  if (typeof showTab === 'function') showTab('tracker');
}

// ====== Export / Import (gated) ======
function exportCSV(){
  let rows = [['#','Customer','Units','Pallets','Start','Closed','OrderRate']];
  picks.forEach((o,i)=>{
    var s = hm(o.start), e = hm(o.close);
    var excl = (o.log && Array.isArray(o.log.breaks))
      ? o.log.breaks.reduce((a,b)=>a+(b.minutes||0),0)
      : (o.excl||0);
    var net  = (e > s) ? (e - s) - (excl)/60 : 0.01;
    var rate = Math.round(o.units/Math.max(0.01,net));
    rows.push([i+1,o.name,o.units,o.pallets,o.start,o.close,rate]);
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

// ====== Current order units done (single source of truth) ======
function currentOrderUnitsDone(){
  if (!current) return 0;

  const total = current.total || 0;

  // Shared: trust sharedMySum (clamped)
  if (current.shared) {
    const mine = Number(window.sharedMySum || 0);
    return Math.max(0, Math.min(total, Number.isFinite(mine) ? mine : 0));
  }

  // If submitWrapLeft just ran, use that immediately
  if (Number.isFinite(current._lastWrapLeft)) {
    return Math.max(0, total - Math.max(0, current._lastWrapLeft));
  }

  // Otherwise prefer last wrap record
  if (Array.isArray(window.tempWraps) && window.tempWraps.length){
    const last = window.tempWraps[window.tempWraps.length - 1];
    const left = Number(last?.left);
    if (Number.isFinite(left)) {
      return Math.max(0, total - Math.max(0, left));
    }
  }

  // Fallback: sum of closed order units (best-effort)
  let done = 0;
  if (Array.isArray(window.picks)) {
    for (const p of window.picks) done += (+p.units || 0);
  }
  return Math.max(0, Math.min(total, done));
}

// ====== Summary chips (Live, Total, etc.) ======
function updateSummary(){
  const closedUnits = Array.isArray(picks)
    ? picks.reduce((a,b)=> a + (+b.units || 0), 0)
    : 0;

  const progress   = currentOrderUnitsDone();
  const totalUnits = closedUnits + progress;

  const s       = hm(getSnappedStartHHMM());
  const endHHMM = getEffectiveLiveEndHHMM();
  const e       = hm(endHHMM);
  const live    = (!isNaN(s) && !isNaN(e) && e > s)
    ? Math.round(totalUnits / (e - s))
    : 0;

  const tLenEl  = document.getElementById('tLen');
  const shiftLen= parseFloat(tLenEl?.value || '9');
  const dayAvg  = shiftLen > 0 ? Math.round(totalUnits / shiftLen) : 0; // kept for future tiles if needed

  const chipRate = document.getElementById('chipRate');
  const chipVal  = document.getElementById('chipRateVal');

  if (chipVal) chipVal.textContent = live ? (live + ' u/h') : '—';
  if (chipRate) {
    chipRate.classList.remove('good','warn','bad');
    if (live >= 300)      chipRate.classList.add('good');
    else if (live >= 249) chipRate.classList.add('warn');
    else                  chipRate.classList.add('bad');
  }

  const totalEl = document.getElementById('chipTotalVal');
  if (totalEl) totalEl.textContent = totalUnits;

  // elapsedMin/hours are implicitly used by other tiles; no extra DOM here
  const elapsedMin = (!isNaN(s) && !isNaN(e) && e > s)
    ? Math.round((e - s) * 60)
    : 0;
  const eh = Math.floor(elapsedMin / 60), em = elapsedMin % 60;
  // (eh/em kept for future display if you want an elapsed chip)

  updateEndShiftVisibility();
  updateEndPickingVisibility();
  updateCloseEarlyVisibility();
}

// ====== Elapsed chip (order-running timer) ======
function updateElapsedChip() {
  const chipBox = document.getElementById('chipElapsed');
  const chipVal = document.getElementById('chipElapsedVal');
  if (!chipBox || !chipVal) return;

  // If a break is active, tickBreak() manages the display
  if (breakDraft) return;

  // Only show elapsed while an order is active
  if (!current || !current.start) {
    chipBox.style.display = 'none';
    chipVal.textContent   = '—';
    chipBox.classList.remove('green','amber');
    return;
  }

  // Order running → show "Elapsed" from order start
  const label = chipBox.querySelector('b');
  if (label) label.textContent = 'Elapsed';

  const now        = nowHHMM();
  const elapsedMin = Math.max(0, Math.round((hm(now) - hm(current.start)) * 60));

  chipVal.textContent = `${elapsedMin} min`;
  chipBox.classList.remove('green','amber');
  chipBox.style.display = '';
}

// ====== Live rate snapshot helpers ======
function computeLiveRateSnapshot(){
  return computeLiveSnapshot().live;
}

// Live modal state
let liveModalTick   = null;
let liveOverrideLeft = null; // preview-only remaining units; NOT persisted

function computeLiveSnapshot() {
  // Always “now” → matches the chip’s intent
  const closedUnits = picks.reduce((a,b)=>a+b.units, 0);
  const progress    = currentOrderUnitsDone(); // in-progress order contribution
  const totalUnits  = closedUnits + progress;

  const snappedHHMM = getSnappedStartHHMM();
  const s = hm(snappedHHMM);
  const e = hm(getEffectiveLiveEndHHMM());
  const hours      = (!isNaN(s) && !isNaN(e) && e > s) ? (e - s) : 0;
  const live       = hours > 0 ? Math.round(totalUnits / hours) : 0;
  const elapsedMin = hours > 0 ? Math.round(hours * 60) : 0;

  return { totalUnits, hours, elapsedMin, live };
}

function fmtElapsed(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h ${String(m).padStart(2,'0')}m`;
}

function paintRatePill(el, rate){
  if (!el) return;
  const parent = el.parentElement;
  if (!parent || !parent.classList) return;

  parent.classList.remove('good','warn','bad');
  if (rate >= 300)      parent.classList.add('good');
  else if (rate >= 249) parent.classList.add('warn');
  else                  parent.classList.add('bad');
}

function renderLiveModalOnce() {
  // Base snapshot (closed units)
  const closedUnits = picks.reduce((a,b)=>a+b.units, 0);

  // Progress: either real-time or preview using override "left"
  let progress = currentOrderUnitsDone();
  if (current && liveOverrideLeft !== null && !isNaN(liveOverrideLeft)) {
    const max  = current.total || 0;
    const left = Math.max(0, Math.min(liveOverrideLeft, max));
    progress   = (current.total || 0) - left;
  }

  const totalUnits = closedUnits + progress;

  // Use snapped (quarter-hour) start
  const snappedHHMM = (typeof getSnappedStartHHMM === 'function')
    ? getSnappedStartHHMM()
    : startTime;

  const s = hm(snappedHHMM);        // decimal hours
  const e = hm(getEffectiveLiveEndHHMM());
  const hours = (!isNaN(s) && !isNaN(e) && e > s) ? (e - s) : 0;  // elapsed AFTER snap
  const live  = hours > 0 ? Math.round(totalUnits / hours) : 0;

  const totEl = document.getElementById('live_totUnits');
  const elEl  = document.getElementById('live_elapsed');
  const rEl   = document.getElementById('live_rate');
  const fEl   = document.getElementById('live_formula');

  if (totEl) totEl.textContent = String(totalUnits);
  if (rEl) {
    rEl.textContent = (live || 0) + ' u/h';
    paintRatePill(rEl, live);
  }

  // Header: show pending quarter-hour until live begins
  const hdr      = document.getElementById('liveTitle');
  const nowVal   = e;
  const snapVal  = s;
  const beforeStart = (!isNaN(nowVal) && !isNaN(snapVal) && nowVal < snapVal);

  if (hdr) {
    hdr.textContent = beforeStart
      ? `Live Rate – starts at ${snappedHHMM}`
      : 'Live Rate – Now';
  }

  // Elapsed: countdown until snap, then normal elapsed
  if (elEl) {
    if (beforeStart) {
      const remainingMin = Math.max(0, Math.ceil((snapVal - nowVal) * 60));
      elEl.textContent = `-${fmtElapsed(remainingMin)}`;
      // keep the countdown ticking once per second until start
      setTimeout(renderLiveModalOnce, 1000);
    } else {
      const elapsedMin = Math.round(hours * 60);
      elEl.textContent = hours ? fmtElapsed(elapsedMin) : '—';
    }
  }

  // Remove the "Formula" block to de-bulk the bottom area
  if (fEl) {
    const maybeLabel = fEl.previousElementSibling;
    if (maybeLabel && maybeLabel.classList && maybeLabel.classList.contains('hint')) {
      maybeLabel.style.display = 'none';
    }
    fEl.textContent = '';
    fEl.style.display = 'none';
  }

  // Preview hint
  const hint = document.getElementById('live_hint');
  if (hint) hint.textContent = (liveOverrideLeft !== null) ? 'Preview only — not saved.' : '';
}

function openLiveUpdateModal(){
  if (!current) {
    alert('No active order to update. Start an order first.');
    return;
  }

  const max       = current.total || 0;
  const suggested = tempWraps.length ? tempWraps[tempWraps.length-1].left : max;

  const modal = document.getElementById('liveUpdateModal');
  const input = document.getElementById('liveLeftInput');
  const hint  = document.getElementById('liveUpdateHint');

  if (hint)  hint.textContent = `Enter a whole number between 0 and ${max}`;
  if (input) {
    input.value = suggested;
    input.min   = 0;
    input.max   = String(max);
  }

  if (modal) {
    modal.style.display = 'flex';
    setTimeout(()=> input?.focus(), 0);
  }
}

function closeLiveUpdateModal(){
  const modal = document.getElementById('liveUpdateModal');
  if (modal) modal.style.display = 'none';
}

function submitLiveUpdateLeft(){
  if (!current) return closeLiveUpdateModal();

  const max   = current.total || 0;
  const input = document.getElementById('liveLeftInput');
  if (!input) {
    alert('Could not find input field for remaining units.');
    return;
  }

  const raw = (input.value || '').trim();
  const val = parseInt(raw, 10);

  if (isNaN(val) || val < 0 || val > max) {
    alert(`Enter a whole number between 0 and ${max}`);
    return;
  }

  // Preview-only override for the Live modal
  liveOverrideLeft = val;
  renderLiveModalOnce();
  closeLiveUpdateModal();
}

function livePromptLeft(){
  if (!current) {
    alert('No active order to preview. Start an order first.');
    return;
  }
  const max       = current.total || 0;
  const suggested = tempWraps.length ? tempWraps[tempWraps.length-1].left : max;

  const val = prompt(`How many units remain on ${current.name}? (0–${max})`, String(suggested));
  if (val === null) return; // cancelled

  const left = parseInt(val, 10);
  if (isNaN(left) || left < 0 || left > max) {
    alert('Enter a whole number between 0 and ' + max);
    return;
  }

  // Set preview-only override and rerender
  liveOverrideLeft = left;
  renderLiveModalOnce();
}

function closeLiveModal(){
  const m = document.getElementById('liveModal');
  if (!m) return;
  m.style.display = 'none';
  if (liveModalTick) { clearInterval(liveModalTick); liveModalTick = null; }
  liveOverrideLeft = null;   // clear preview when closing
}

// ====== Countback keypad logic ======
// IMPORTANT: max 2 digits per field + auto-advance
const CB_MAX = { layers: 2, ul: 2, extras: 2 };

function getActiveCustomerCode(){
  // Prefer QuickCalc customer if it exists (WQT side)
  const qcSel = document.getElementById('qcCustomer');
  if (qcSel) {
    const qcOther = document.getElementById('qcOther');
    let code = qcSel.value;
    if (code === '__OTHER__') code = upcase6((qcOther?.value) || '');
    if (isValidCode(code)) return code;
  }

  // Otherwise use Tracker's active selector
  const oSel = document.getElementById('oCust');
  if (oSel) {
    const oOther = document.getElementById('oOther');
    let code = oSel.value;
    if (code === '__OTHER__') code = upcase6((oOther?.value) || '');
    if (isValidCode(code)) return code;
  }

  // Fallback: generic bucket
  return '__GEN__';
}

function renderULayerChips(){
  const box = document.getElementById('cbChips');
  if (!box) return;
  box.innerHTML = '';

  const code = getActiveCustomerCode();
  const freq = learnedUL[code] || {};
  const entries = Object
    .entries(freq)
    .filter(([v,c])=> c >= 2)
    .sort((a,b)=> b[1] - a[1])
    .slice(0,6);

  entries.forEach(([v])=>{
    const b = document.createElement('button');
    b.className   = 'btn slim';
    b.type        = 'button';
    b.textContent = v + '/layer';
    b.addEventListener('click', ()=>{
      cbVals.ul = String(v);
      updateCbDisplays();
      computeCbTotal();
    });
    box.appendChild(b);
  });
}

function cbSetFocus(which){
  cbFocus = which;
  const hint = document.getElementById('cbHint');
  if (!hint) return;
  hint.textContent =
    (which === 'layers') ? 'Typing Layers…' :
    (which === 'ul')     ? 'Typing U/Layer…' :
                           'Typing Extras…';
}

function cbTap(d){
  // append digit with 2-char cap
  const cap = CB_MAX[cbFocus] || 2;
  cbVals[cbFocus] = (cbVals[cbFocus] || '') + d;
  if (cbVals[cbFocus].length > cap) {
    cbVals[cbFocus] = cbVals[cbFocus].slice(0, cap);
  }

  // Smart-advance for LAYERS: 1–19
  if (cbFocus === 'layers') {
    const s = cbVals.layers;

    // If first digit is 0 and a second digit exists (e.g., '08'), normalize to single-digit '8'
    if (s.length === 2 && s[0] === '0') {
      cbVals.layers = s[1];
    }

    // After typing first digit:
    if (cbVals.layers.length === 1) {
      const first = cbVals.layers[0];
      // If first digit is 2–9, that's a complete layer count → auto-next now
      if (first >= '2' && first <= '9') {
        updateCbDisplays();
        computeCbTotal();
        cbNextField();
        return;
      }
      // If first digit is '1', wait for second digit (10–19) before moving on
    }

    // After second digit with leading '1', clamp to 10–19 and next
    if (cbVals.layers.length === 2 && cbVals.layers[0] === '1') {
      const n = Math.min(19, Math.max(10, toInt(cbVals.layers)));
      cbVals.layers = String(n);
      updateCbDisplays();
      computeCbTotal();
      cbNextField();
      return;
    }
  }

  // Default behavior for UL & EXTRAS (2 digits then next)
  updateCbDisplays();
  computeCbTotal();
  if (cbVals[cbFocus].length >= cap) cbNextField();
}

function cbBack(){
  const s = cbVals[cbFocus] || '';
  cbVals[cbFocus] = s.slice(0, -1);
  updateCbDisplays();
  computeCbTotal();
}
function cbReset(){
  cbVals = { layers:'', ul:'', extras:'' };
  cbSetFocus('layers');
  updateCbDisplays();
  computeCbTotal();
}

function cbNextField(){
  if (cbFocus === 'layers')      cbSetFocus('ul');
  else if (cbFocus === 'ul')     cbSetFocus('extras');
  else                           cbSetFocus('extras');
}

function updateCbDisplays(){
  const elL = document.getElementById('cbLayers');
  const elU = document.getElementById('cbUL');
  const elE = document.getElementById('cbExtras');
  if (elL) elL.textContent = cbVals.layers || '0';
  if (elU) elU.textContent = cbVals.ul     || '0';
  if (elE) elE.textContent = cbVals.extras || '0';
}

function computeCbTotal(){
  const L = toInt(cbVals.layers);
  const U = toInt(cbVals.ul);
  const E = toInt(cbVals.extras);
  const total = (L * U) + E;

  const totalEl = document.getElementById('cbTotal');
  if (totalEl) totalEl.textContent = total;
  return total;
}

// ====== Wrap input → button label (“Log Wrap” vs “Close Order”) ======
function refreshWrapButton() {
  const inp = document.getElementById('oLeft');
  const btn = document.querySelector('#orderArea button[onclick="logWrap()"]');
  if (!btn || !inp) return;

  const val = (inp.value || '').trim();
  if (val === '0') {
    btn.textContent = 'Close Order';
    btn.classList.add('ok');
  } else {
    btn.textContent = 'Log Wrap';
    btn.classList.remove('ok');
  }
}

// NOTE: the small DOMContentLoaded binding that used to live here
// has been removed. refreshWrapButton is now wired once from the
// main boot block below (search for `oLeft` there).

// ====== QuickCalc live result ======
function recalcQuick(){
  const DEFAULT_RATE = 300;
  const units   = toInt(document.getElementById('qcUnits')?.value);
  const rawRate = (document.getElementById('qcRate')?.value || '').trim();
  const rate    = (/^\d+$/.test(rawRate) && parseInt(rawRate,10) > 0)
    ? parseInt(rawRate,10)
    : DEFAULT_RATE;

  const timeHours    = rate > 0 ? (units / rate) : 0;
  const totalMinutes = Math.round(timeHours * 60);
  const hh           = Math.floor(totalMinutes / 60);
  const mm           = totalMinutes % 60;

  const timeEl  = document.getElementById('qcTime');
  const rateEl  = document.getElementById('qcRateUsed');
  const unitsEl = document.getElementById('qcUnitsEcho');

  if (timeEl)  timeEl.textContent  = units > 0 ? `${hh}h ${String(mm).padStart(2,'0')}m` : '—';
  if (rateEl)  rateEl.textContent  = rate + ' u/h';
  if (unitsEl) unitsEl.textContent = units || 0;
}

// ====== Live Rate modal open (main entrypoint) ======
function openLiveModal(){
  const m = document.getElementById('liveModal');
  if (!m) return;

  m.style.display = 'flex';

  // fresh preview state each open
  liveOverrideLeft = null;

  renderLiveModalOnce();

  if (liveModalTick) clearInterval(liveModalTick);
  // keep the numbers live while the modal is open
  liveModalTick = setInterval(renderLiveModalOnce, 600);
}

// ====== Weekly card collapse/expand ======
function initWeekCardToggle(){
  const card    = document.getElementById('weekCard');
  const header  = document.getElementById('weekHeader');
  const content = document.getElementById('weekContent');
  const chev    = document.getElementById('weekChevron');
  if (!card || !header || !content) return;

  function apply(collapsed){
    card.classList.toggle('collapsed', collapsed);
    header.setAttribute('aria-expanded', String(!collapsed));
    if (chev) chev.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    try {
      localStorage.setItem('weekCardCollapsed', collapsed ? '1' : '0');
    } catch(e){}
  }

  // Re-apply saved state every time we call this (safe)
  let saved = null;
  try { saved = localStorage.getItem('weekCardCollapsed'); } catch(e){}
  apply(saved === null ? true : saved === '1');

  // Prevent duplicate listeners across tab switches
  if (card.dataset.bound === '1') return;

  const toggle = ()=> apply(!card.classList.contains('collapsed'));
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  card.dataset.bound = '1';
}

// ====== Action row layout (delay / breaks / undo / CE) ======
function ensureActionRowLayout(){
  const delayBtn = document.getElementById('btnDelay');
  if (!delayBtn || !delayBtn.parentElement) return;

  const row = delayBtn.parentElement;

  // Create groups once
  let left  = document.getElementById('actionsLeft');
  let right = document.getElementById('actionsRight');
  if (!left){
    left = document.createElement('div');
    left.id = 'actionsLeft';
    row.insertBefore(left, row.firstChild);
  }
  if (!right){
    right = document.createElement('div');
    right.id = 'actionsRight';
    row.appendChild(right);
  }

  // Lock row layout
  row.style.display       = 'flex';
  row.style.alignItems    = 'center';
  row.style.justifyContent= 'space-between';
  row.style.gap           = '12px';

  // Move buttons into groups (hidden states are fine)
  const btnB   = document.getElementById('btnB');
  const btnL   = document.getElementById('btnL');
  const btnCE  = document.getElementById('btnCloseEarly');
  const btnDel = document.getElementById('btnDelay');
  const btnUn  = document.getElementById('btnUndo');

  [btnB, btnL, btnCE].forEach(el => { if (el && el.parentNode !== left)  left.appendChild(el); });
  [btnDel, btnUn].forEach(el => { if (el && el.parentNode !== right) right.appendChild(el); });

  left.style.display  = 'flex';
  left.style.gap      = '10px';
  right.style.display = 'flex';
  right.style.gap     = '10px';
}

// ====== Boot ======
document.addEventListener('DOMContentLoaded', function () {
  try {
    // ── 1) Restore persisted state FIRST ────────────────────────────
    loadCustomCodes();
    loadAll(); // hydrates: startTime, current, tempWraps, picks, historyDays, etc.

    // If we just came back from Snake, auto-log that congestion delay
    if (typeof applySnakeDelayIfAny === 'function') applySnakeDelayIfAny();

    const hadShift = !!startTime;
    const hadOpen  = !!(current && Number.isFinite(current.total));

    // ── 2) Build customer dropdowns (safe post-restore) ─────────────
    buildDropdown('oDD','oCust','oOther','o');
    reloadDropdowns();

    // ── 3) Wire modals & inputs ─────────────────────────────────────
    document.getElementById('chipElapsed')
      ?.addEventListener('click', openElapsedModal);

    document.getElementById('elapsedModal')
      ?.addEventListener('click', (e)=>{
        if (e.target?.id === 'elapsedModal') closeElapsedModal();
      });

    // Wire Pro Unlock (Override Rate box)
    document.getElementById('qcRate')
      ?.addEventListener('input',  updCalcGate);
    document.getElementById('qcRate')
      ?.addEventListener('change', updCalcGate);

    document.getElementById('oOther')
      ?.addEventListener('input', ()=>onOtherInput('o'));

    // Live wrap-button label (single wiring – duplicate was removed above)
    document.getElementById('oLeft')
      ?.addEventListener('input', refreshWrapButton);

    document.getElementById('liveUpdateModal')
      ?.addEventListener('click', (e)=>{
        if (e.target?.id === 'liveUpdateModal') closeLiveUpdateModal();
      });

    document.getElementById('chipRate')
      ?.addEventListener('click', openLiveModal);

    document.getElementById('liveModal')
      ?.addEventListener('click', (e)=>{
        if (e.target?.id === 'liveModal') closeLiveModal();
      });

    // ── 4) Pro gate & static renders that don't mutate core state ───
    applyProGate();

    // ── 5) Shift/Order shell visibility based on restored flags ─────
    const shift  = document.getElementById('shiftCard');
    const active = document.getElementById('activeOrderCard');
    const done   = document.getElementById('completedCard');

    if (hadShift && window.archived !== true) {
      if (shift)  shift.style.display  = 'none';
      if (active) active.style.display = 'block';
      if (done)   done.style.display   = (picks.length ? 'block' : 'none');
    } else {
      // No shift yet → hide order-only controls by default
      ['btnDelay','btnUndo','btnB','btnL','btnCloseEarly'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }

    renderShiftPanel?.();

    // ── 6) Decide header: progress vs new-order form ────────────────
    if (hadOpen && window.archived !== true) {
      // We have an active order: ensure progress header/UI is shown
      restoreActiveOrderUI();

      // Seed labels (defensive)
      const ddToggle = document.querySelector('#oDD .dd-toggle');
      if (ddToggle && current?.name) ddToggle.textContent = current.name;
      const oTot = document.getElementById('oTotal');
      if (oTot && Number.isFinite(current.total)) oTot.value = String(current.total);

      // Elapsed chip ON
      const chip = document.getElementById('chipElapsed');
      if (chip?.style) chip.style.display = '';
      updateElapsedChip?.();
      setElapsedChipClickable?.(true);
      showTab('tracker'); // keep user on Tracker with live header visible
      showToast('Shift restored – continue where you left off');
    } else {
      // No open order yet → show the new-order header/form and hide area
      const hdrForm = document.getElementById('orderHeaderForm');
      const hdrProg = document.getElementById('orderHeaderProgress');
      const area    = document.getElementById('orderArea');
      if (hdrForm) hdrForm.style.display = 'block';
      if (hdrProg) hdrProg.style.display = 'none';
      if (area)    area.style.display    = 'none';
      const chip = document.getElementById('chipElapsed');
      if (chip?.style) chip.style.display = 'none';
      const v = document.getElementById('chipElapsedVal');
      if (v) v.textContent = '—';
      setElapsedChipClickable?.(false);
    }

    // ── 7) Heavy renders AFTER state/UI decision (prevents flips) ───
    renderHistory();
    renderWeeklySummary();
    initWeekCardToggle();
    renderDone();
    renderULayerChips();
    renderShiftPanel?.();

    // ── 8) Start button validation (order of entry agnostic) ────────
    ['oTotal','oOther'].forEach(id=>{
      const el = document.getElementById(id);
      if (!el) return;
      ['input','change','keyup','blur'].forEach(ev =>
        el.addEventListener(ev, refreshStartButton)
      );
    });
    document.getElementById('oCust')
      ?.addEventListener('change', refreshStartButton);
    document.querySelector('#oDD .dd-menu')
      ?.addEventListener('click', ()=> setTimeout(refreshStartButton,0));
    document.querySelector('#oDD .dd-toggle')
      ?.addEventListener('click', ()=> setTimeout(refreshStartButton,0));
    refreshStartButton();

    // ── 9) Elapsed-only ticker (no rate refresh) ────────────────────
    try {
      if (current) {
        updateElapsedChip?.();       // ticks minutes on the chip
        setElapsedChipClickable?.(true);
      } else {
        setElapsedChipClickable?.(false);
      }
      // DO NOT call updateSummary() here; that would refresh rate.
    } catch(e){}

    // Keep the chip ticking, but don't touch Live Rate or summary.
    setInterval(function () {
      if (breakDraft) {
        setElapsedChipClickable?.(false);
        return;
      }
      if (current) {
        updateElapsedChip?.();       // ONLY updates the elapsed minutes display
        setElapsedChipClickable?.(true);
      } else {
        setElapsedChipClickable?.(false);
      }
    }, 10000);

    // ── 10) QuickCalc wiring ────────────────────────────────────────
    const qcRateEl  = document.getElementById('qcRate');
    const qcUnitsEl = document.getElementById('qcUnits');
    if (qcRateEl){
      qcRateEl.addEventListener('input',  ()=>{ updCalcGate(); recalcQuick(); });
      qcRateEl.addEventListener('change', ()=>{ updCalcGate(); recalcQuick(); });
    }
    if (qcUnitsEl){
      qcUnitsEl.addEventListener('input',  recalcQuick);
      qcUnitsEl.addEventListener('change', recalcQuick);
    }

    // Countback & keyboard input
    cbSetFocus('layers');
    updateCbDisplays();
    computeCbTotal();

    document.addEventListener('keydown', (e)=>{
      const tag = (e.target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (/^[0-9]$/.test(e.key)) {
        cbTap(e.key);
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        cbBack();
        e.preventDefault();
      } else if (e.key === ' ' || e.key === 'Enter') {
        cbNextField();
        e.preventDefault();
      }
    });

    // Initial compute for QuickCalc
    recalcQuick();

    // Final pass refresh (stable snapshot)
    updateSummary();
    updateDelayBtn();
    updateEndShiftVisibility();
    updateEndPickingVisibility();
    updateCloseEarlyVisibility();
    updateElapsedChip();

    // Wire Shared Pick bottom bar (padUnits / padSubmit) once DOM is ready
    initSharedPad?.();

    saveAll?.();
  } catch (err) {
    console.error(err);
    showToast('Error on load: ' + (err.message || err));
  }
});


// Shared pad: wire up bar input + Add button → sharedSubmitUnits + visual confirm
function initSharedPad(){
  const inp    = document.getElementById('padUnits');
  const btn    = document.getElementById('padSubmit');
  const hidden = document.getElementById('sharedUnitsDock');
  if (!inp || !btn || !hidden) return;

  function doSubmit(){
    const v = parseInt(inp.value || '0', 10);
    if (!(v > 0)) {
      inp.focus();
      return;
    }

    // Pipe value into the hidden field used by sharedSubmitUnits()
    hidden.value = String(v);
    sharedSubmitUnits();

    // Clear + collapse keyboard
    inp.value = '';
    inp.blur();

    // Flash the Add button green for a few seconds
    btn.classList.add('shared-pad-added');
    // reset after ~3s
    setTimeout(() => {
      btn.classList.remove('shared-pad-added');
    }, 3000);
  }

  // Click Add
  btn.addEventListener('click', doSubmit);

  // Pressing Enter on the numeric field should act like Add
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      doSubmit();
    }
  });
}

function openWrapModal(){
  if (!current) return;
  const m   = document.getElementById('wrapModal');
  const inp = document.getElementById('wrapLeftInput');
    // Onboarding trigger — wrap modal guidance
  Onboard.showHint("wrap", "Enter units left on the pallet. Type 0 when finishing the order.");

  const total    = current.total || 0;
  const lastLeft = tempWraps.length ? tempWraps[tempWraps.length - 1].left : total;

  if (inp) {
    if (current?.shared) {
      const total  = current.total || 0;
      const mySum  = Math.max(0, window.sharedMySum || 0);
      const myLeft = Math.max(0, total - mySum);

      inp.value       = String(myLeft);
      inp.placeholder = String(myLeft);
      inp.setAttribute('disabled', 'disabled'); // lock during shared wrap
    } else {
      inp.value       = '';
      inp.placeholder = String(lastLeft);
      inp.removeAttribute('disabled');
    }
    // ensure only one listener (avoid dupes)
    inp.removeEventListener('input', refreshWrapModalBtn);
    inp.addEventListener('input', refreshWrapModalBtn);
  }
  if (m) m.style.display = 'flex';
  setTimeout(()=>inp?.focus(), 10);
  refreshWrapModalBtn(); // set initial label
}

function refreshWrapModalBtn(){
  const inp  = document.getElementById('wrapLeftInput');
  const btn  = document.querySelector('#wrapModal .actions .btn.ok');
  const hint = document.getElementById('wrapHint');
  if (!inp || !btn) return;

  const isZero = (inp.value || '').trim() === '0';
  btn.textContent = isZero ? 'Complete' : 'Save Wrap';
  if (hint) hint.textContent = isZero
    ? 'Ready to complete this order.'
    : 'Type 0 to enable Complete.';
}

function closeWrapModal(){
  const m   = document.getElementById('wrapModal');
  const inp = document.getElementById('wrapLeftInput');
  if (m) m.style.display = 'none';
  inp?.removeEventListener('input', refreshWrapModalBtn);
  inp?.removeAttribute('disabled');
}

function submitWrapLeft(){
  if (!current) return alert('Start an order first');

  const inp   = document.getElementById('wrapLeftInput');
  const total = current.total || 0;

  // 1) Get candidate "left"
  let v = toInt(inp?.value);
  const typedEmpty = !inp || String(inp.value).trim() === '' || !Number.isFinite(v);

  if (current?.shared) {
    // Shared: default to my current left if user didn't type
    const mySum  = Math.max(0, Number(window.sharedMySum || 0));
    const myLeft = Math.max(0, total - mySum);
    if (typedEmpty) {
      v = myLeft;
      if (inp) inp.value = String(v);
    }
  } else {
    // Single-picker: must have a valid typed number
    if (typedEmpty) {
      inp?.focus();
      return alert('Enter units left');
    }
  }

  // 2) Guardrails
  v = Number.isFinite(v) ? v : 0;
  if (v < 0 || v > total) {
    inp?.focus();
    return alert('Units left must be between 0 and total');
  }

  const prevLeft = (Array.isArray(window.tempWraps) && window.tempWraps.length)
    ? Number(window.tempWraps[window.tempWraps.length - 1].left)
    : total;

  if (!Number.isFinite(prevLeft)) return alert('Previous wrap state invalid');
  if (v > prevLeft) {
    inp?.focus();
    return alert('Units left cannot increase vs previous wrap');
  }

  const done = prevLeft - v;
  if (done <= 0) {
    inp?.focus();
    return alert('No progress since last wrap');
  }

  // 3) Sync legacy field and set explicit source-of-truth for totals
  const oLeft = document.getElementById('oLeft');
  if (oLeft) oLeft.value = String(v);
  // *** KEY: make last wrap "left" available immediately to the summary path
  current._lastWrapLeft = v;

  // 4) Snapshot per-order rate/ETA
  if (current) {
    let rateSnap = 0;
    try {
      rateSnap = Math.round(orderLiveRate?.() || 0);
      if (!rateSnap || rateSnap <= 0) {
        const chip = document.getElementById('chipRateVal');
        const m    = chip ? String(chip.textContent||'').match(/(\d+)/) : null;
        const chipUh = m ? parseInt(m[1],10) : 0;
        rateSnap = chipUh || Math.round(predictive?.rateUh || 0) || 0;
      }
    } catch(e){ rateSnap = 0; }

    if (rateSnap > 0) current.orderRateUh = rateSnap;

    const leftNow = Math.max(0, v);
    const useRate = current.orderRateUh || current.preWrapRateUh || 0;
    if (useRate > 0) {
      const mins = Math.round((leftNow / useRate) * 60);
      current.fixedETA = addMinutesToTime(nowHHMM(), mins);
    }

    const rEl = document.getElementById('progRate');
    const eEl = document.getElementById('progETA');
    if (rEl) rEl.textContent = useRate ? `${useRate} u/h` : '—';
    if (eEl) eEl.textContent = current.fixedETA || '—';
  }

  // 5) Finish UI + pipeline
  closeWrapModal();

  refreshWrapButton?.();
  logWrap?.();                 // pushes into tempWraps
  updateSummary?.();           // now sees current._lastWrapLeft immediately
  updateElapsedChip?.();

  if (current?.shared) {
    window.sharedBlock = 0;
    try { updateSharedDockInfo?.(); } catch(e){}
  }

  updateHeaderActions?.();
  showToast?.(`Wrap logged (+${done})`);
}
// Global helpers to show/hide the bottom Shared Pick bar (#sharedPad)
function showSharedPad(){
  const pad = document.getElementById('sharedPad');
  if (!pad) return;
  pad.style.display = 'block';
  // Keep content above the bar so it never hides "Close Early..."
  document.body.style.paddingBottom = '72px';
}

function hideSharedPad(){
  const pad = document.getElementById('sharedPad');
  if (!pad) return;
  pad.style.display = 'none';
  document.body.style.paddingBottom = '';
  const inp = document.getElementById('padUnits');
  if (inp) inp.blur();
}

// Control and persist open/closed state
function persistSharedPadOpen(open){
  try {
    localStorage.setItem('sharedDockOpen', open ? '1' : '0');
  } catch(e){}
  if (open) showSharedPad?.();
  else      hideSharedPad?.();
}

// Preserve pad open state if shared order refreshes
window.addEventListener('beforeunload', ()=>{
  try {
    if (window.current && window.current.shared) {
      localStorage.setItem('sharedDockOpen','1');
    } else {
      localStorage.setItem('sharedDockOpen','0');
    }
  } catch(e){}
});

function updateHeaderActions(){
  const inOrder = (typeof hasActiveOrder === 'function' && hasActiveOrder())
    || !!(current && Number.isFinite(current?.total));
  const wrapBtn = document.getElementById('btnWrapTop');
  if (wrapBtn) wrapBtn.disabled = !inOrder;
}

// Shared numeric pad for shared dock (delayed init so DOM is fully ready)
setTimeout(() => {
  (function initSharedNumPad(){
    const dock      = document.getElementById('sharedDock');
    const pad       = document.getElementById('sharedNumPad');
    const inp       = document.getElementById('sharedUnitsDock');
    const submitBtn = document.getElementById('sharedSubmitBtn');
    if (!dock || !pad || !inp || !submitBtn) return;

    // --- layout ---
    pad.style.position           = 'fixed';
    pad.style.left               = '0';
    pad.style.right              = '0';
    pad.style.bottom             = '0';
    pad.style.zIndex             = '31';
    pad.style.display            = 'none';
    pad.style.gridTemplateColumns= 'repeat(3,1fr)';
    pad.style.background         = '#0f131b';
    pad.style.borderTop          = '1px solid #29364a';
    pad.style.padding            = '6px 10px';
    pad.style.gap                = '6px';
    pad.style.transition         = 'opacity 0.25s ease';
    pad.style.opacity            = '0';

    // phone layout + final row: ⌫ | 0 | ✔
    const keys = ['1','2','3','4','5','6','7','8','9','⌫','0','✔'];
    pad.innerHTML = '';

    keys.forEach(k=>{
      const b = document.createElement('button');
      b.textContent   = (k === '✔') ? 'Submit' : k;
      b.className     = 'btn ok';
      b.style.padding = '14px 0';
      b.style.fontSize= '20px';
      b.style.background = '#1a2a40';
      if (k === '⌫') b.classList.add('ghost');
      if (k === '✔') b.style.background = '#1f3d2c'; // green tint for submit
      b.onclick = ()=>{
        if (k === '⌫')     inp.value = inp.value.slice(0,-1);
        else if (k === '✔') submitBtn.click();
        else               inp.value += k;
      };
      pad.appendChild(b);
    });

    let openedAt = 0;
    function showPad(){
      openedAt = Date.now();
      pad.style.display = 'grid';
      requestAnimationFrame(()=> pad.style.opacity = '1');
      dock.style.bottom = '200px';
    }
    function hidePad(){
      pad.style.opacity = '0';
      dock.style.bottom = '0';
      setTimeout(()=> pad.style.display = 'none', 250);
    }

    inp.addEventListener('focus', showPad);
    document.addEventListener('click', e=>{
      if (Date.now() - openedAt < 300) return;
      if (!pad.contains(e.target) && e.target !== inp) hidePad();
    });

    const orig = submitBtn.onclick;
    submitBtn.onclick = function(ev){
      if (orig) orig.call(this, ev);
      inp.value = '';
      hidePad();
    };
  })();
}, 500);

(function preloadOnboarding(){
  // Avoid duplicate loads
  if (window.__onboard_preloaded) return;
  window.__onboard_preloaded = true;

  fetch("onboarding.html")
    .then(res => res.text())
    .then(html => {
      // Inject HTML (including overlay + script tag)
      const temp = document.createElement("div");
      temp.innerHTML = html;
      document.body.appendChild(temp);

      // Manually execute the embedded script
      const script = temp.querySelector("script");
      if (script) {
        const s = document.createElement("script");
        s.textContent = script.textContent;
        document.body.appendChild(s);
      }

      // Initialise after scripts are live
      setTimeout(() => {
        if (window.Onboard?.init) window.Onboard.init();
      }, 50);
    })
    .catch(err => console.warn("Onboarding preload failed:", err));
})();
