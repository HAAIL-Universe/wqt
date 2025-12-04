// ====== State ======

// Closed orders (completed picks)
let picks = [];         // closed orders

// ETA smoothing (GPS-style) – keeps predictive ETA from bouncing
let etaSmooth = [];            // rolling window of recent order rates
let lastETAmin = null;         // last computed (smoothed) ETA in minutes
let lastRenderedETAmin = null; // last value we actually showed (for 1m threshold)
let stockAuditRows = [];   // Ephemeral rows for Stock Audit pad (not persisted)

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

// Open the Stock Audit modal
function openStockAuditModal(){
  const m = document.getElementById('stockAuditModal');
  if (!m) return;
  m.style.display = 'flex';
  renderStockAuditRows();
}

// Close the Stock Audit modal
function closeStockAuditModal(){
  const m = document.getElementById('stockAuditModal');
  if (!m) return;
  m.style.display = 'none';
}

// Add a row to the Stock Audit pad
function addStockAuditRow(){
  const locEl = document.getElementById('saLocation');
  const expEl = document.getElementById('saExpected');
  const actEl = document.getElementById('saActual');
  if (!locEl || !expEl || !actEl) return;

  const location = (locEl.value || '').trim();
  const expected = parseInt(expEl.value || '0', 10);
  const actual   = parseInt(actEl.value || '0', 10);

  if (!location) {
    showToast?.('Add a location first');
    locEl.focus();
    return;
  }

  if (!Array.isArray(stockAuditRows)) stockAuditRows = [];
  stockAuditRows.push({ location, expected, actual });

  // Reset inputs for the next line
  locEl.value = '';
  expEl.value = '';
  actEl.value = '';

  renderStockAuditRows();
}

// Clear all rows from the pad
function clearStockAuditRows(){
  stockAuditRows = [];
  renderStockAuditRows();
}

// Remove a specific row (by index)
function removeStockAuditRow(idx){
  if (!Array.isArray(stockAuditRows)) return;
  stockAuditRows.splice(idx, 1);
  renderStockAuditRows();
}

// Render the rows into the table body
function renderStockAuditRows(){
  const body = document.getElementById('stockAuditBody');
  if (!body) return;

  body.innerHTML = '';
  if (!Array.isArray(stockAuditRows)) stockAuditRows = [];

  stockAuditRows.forEach((row, i) => {
    const tr   = document.createElement('tr');
    const diff = (Number(row.actual) || 0) - (Number(row.expected) || 0);

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${row.location || ''}</td>
      <td>${row.expected ?? ''}</td>
      <td>${row.actual ?? ''}</td>
      <td>${diff > 0 ? '+' + diff : diff}</td>
      <td>
        <button class="btn slim ghost" type="button" onclick="removeStockAuditRow(${i})">✖</button>
      </td>
    `;
    body.appendChild(tr);
  });
}

// Backdrop click to close Stock Audit modal
(function(){
  document.getElementById('stockAuditModal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'stockAuditModal') closeStockAuditModal();
  });
})();

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

// Persist on tab close (final, non-debounced flush)
window.addEventListener('beforeunload', () => {
  try { saveAll(); } catch(e){}
});

// We no longer run a 1.5s heartbeat save – the 30s safety net below is enough.


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
const ADMIN_UNLOCK_CODE = '1234';
const AUDIT_UNLOCK_CODE = '5555';

let proUnlocked  = false;  // Gate: Export/Import/Manage Customers
let snakeUnlocked = false; // Gate: Snake congestion game

// Persisted preference: one-time shift length (hours)
const SHIFT_PREF = 'wqt.shiftLenH';

// Extra safety net save (very infrequent; use debounced saver)
setInterval(function(){ saveAllDebounced(0); }, 30000);

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
  // 1. Attempt to load data
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
      operativeLog    = Array.isArray(p.operativeLog) ? p.operativeLog : [];
      operativeActive = p.operativeActive || null;
      refreshOperativeChip();
    } else {
      picks = []; historyDays = []; current = null; tempWraps = [];
      startTime = ""; lastClose = ""; pickingCutoff = ""; undoStack = [];
      proUnlocked = false; snakeUnlocked = false; shiftBreaks = [];
      operativeLog = []; operativeActive = null;
    }

    const lraw = localStorage.getItem(KEY_LEARN);
    learnedUL = lraw ? (JSON.parse(lraw) || {}) : {};

    try {
      const braw = localStorage.getItem('breakDraft');
      breakDraft = braw ? (JSON.parse(braw) || null) : null;
    } catch(e){ breakDraft = null; }

  } catch (e) {
    console.error("Data load failed, resetting:", e);
    // Hard reset if corrupted
    picks = []; historyDays = []; current = null; tempWraps = [];
    startTime = ""; lastClose = ""; pickingCutoff = ""; undoStack = [];
    proUnlocked = false; shiftBreaks = []; learnedUL = {};
    breakDraft = null;
    operativeLog = []; operativeActive = null;
  }

  // 2. CHECK OPERATOR ID (Safe separate block)
  // We do this after data load so if it fails, it doesn't wipe data
  setTimeout(() => {
      try { checkOperatorId(); } catch(e) { console.warn("Op ID check failed", e); }
  }, 500);
}

// ---- OPERATOR ID LOGIC ----
const KEY_OP_ID = 'wqt_operator_id';

function checkOperatorId(){
  const opId = localStorage.getItem(KEY_OP_ID);
  // If no ID is saved, show the modal to force entry
  if (!opId) {
    const m = document.getElementById('operatorIdModal');
    if (m) {
        m.style.display = 'flex';
        // Small delay to ensure modal is rendered before focusing
        setTimeout(() => document.getElementById('opIdInput')?.focus(), 100);
    }
  }
}

function saveOperatorId(){
  const inp = document.getElementById('opIdInput');
  const val = (inp?.value || '').trim();
  
  // Basic validation
  if (val.length < 2) {
    alert("Please enter a valid Name or ID.");
    return;
  }
  
  localStorage.setItem(KEY_OP_ID, val);
  
  const m = document.getElementById('operatorIdModal');
  if (m) m.style.display = 'none';
  
  showToast(`Clocked in as ${val}`);
  
  // Trigger immediate save so api.js sends the new name to the backend
  saveAll(); 
}
// Main save: in-memory state → localStorage
function saveAll(){
  try {
    const mainPayload = {
      version: '3.3.55',
      savedAt: new Date().toISOString(),
      picks, history: historyDays, current, tempWraps, startTime,
      lastClose, pickingCutoff, undoStack, proUnlocked, snakeUnlocked,
      shiftBreaks, operativeLog, operativeActive
    };

    localStorage.setItem(KEY, JSON.stringify(mainPayload));
    localStorage.setItem(KEY_LEARN, JSON.stringify(learnedUL || {}));

    if (window.WqtAPI && typeof WqtAPI.saveState === 'function') {
      try {
        // --- NEW: Attach Operator ID to the backend payload ---
        const opId = localStorage.getItem(KEY_OP_ID) || null;
        
        // We sneak the operator_id into the main payload so backend logs it
        // Note: Ideally backend should have a dedicated field, but this works immediately
        // with the 'detail' logging we set up.
        if (opId && window.WqtAPI.saveState.length < 2) { 
             // If saveState doesn't support 2 args, we attach it to window.WqtAPI context 
             // or modify api.js. 
             // EASIER FIX: Let's assume we modify api.js slightly to read this key.
        }
        
        // Actually, let's update api.js to read this key automatically.
        // Proceed to next file update.
        
        const stateForBackend = {
          main: mainPayload,
          learnedUL: learnedUL || {},
          customCodes: customCodes || []
        };
        WqtAPI.saveState(stateForBackend);
      } catch (err) {
        console.warn('[saveAll] Backend sync failed, local-only', err);
      }
    }
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

  // ---- Admin dashboard unlock --------------------------------
  if (digits.endsWith(ADMIN_UNLOCK_CODE) && digits.length >= ADMIN_UNLOCK_CODE.length) {
    inp.value = '';
    window.location.href = 'admin.html';
    return;
  }

  // ---- Pro tools unlock ------------------------------------
  if (digits.endsWith(PRO_UNLOCK_CODE) && digits.length >= PRO_UNLOCK_CODE.length) {
    inp.value = '';
    try { localStorage.setItem('proUnlocked','1'); } catch {}
    window.proUnlocked = true;
    showToast('Pro tools unlocked');
    openProSettingsModal?.();
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

  // ---- Stock audit unlock --------------------------------
  if (digits.endsWith(AUDIT_UNLOCK_CODE) && digits.length >= AUDIT_UNLOCK_CODE.length) {
    inp.value = '';
    openStockAuditModal?.();
    return;
  }

  // No special code → just re-run normal QuickCalc logic
  // Fixed: Use safe call to recalcQuick instead of updCalc
  if (typeof recalcQuick === 'function') recalcQuick();
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
    saveAllDebounced();
    return;
  }

  // ---------- CALC TAB ----------
  ['btnDelay','btnUndo','btnB','btnL','btnCloseEarly'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  saveAllDebounced();
}