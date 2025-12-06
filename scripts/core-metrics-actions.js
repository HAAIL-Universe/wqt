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

  // Ensure chips are in sync with modal values
  if (typeof refreshSummaryChips === 'function') refreshSummaryChips();

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

// ====== Shift tools accordion ======
function toggleShiftTools() {
  const body = document.getElementById('shift-tools-body');
  const chev = document.getElementById('shift-tools-chevron');
  if (!body) return;

  const nowHidden = body.classList.toggle('hidden');
  if (chev) chev.textContent = nowHidden ? '▸' : '▾';

  const hdr = document.getElementById('shift-tools-toggle');
  if (hdr) hdr.setAttribute('aria-expanded', String(!nowHidden));
}

function initShiftToolsToggle(){
  const card = document.getElementById('shift-tools-card');
  const header = document.getElementById('shift-tools-toggle');
  const body = document.getElementById('shift-tools-body');
  const chev = document.getElementById('shift-tools-chevron');
  if (!card || !header || !body) return;

  function apply(collapsed){
    if (collapsed) body.classList.add('hidden'); else body.classList.remove('hidden');
    if (chev) chev.textContent = collapsed ? '▸' : '▾';
    header.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem('shiftToolsCollapsed', collapsed ? '1' : '0'); } catch(e){}
  }

  let saved = null;
  try { saved = localStorage.getItem('shiftToolsCollapsed'); } catch(e){}
  if (saved !== null) apply(saved === '1');
  else apply(!startTime); // collapsed if no active shift

  if (card.dataset.bound === '1') return;
  const toggle = ()=> apply(body.classList.contains('hidden'));
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e)=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
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

// Return score for a single order
function computeOrderScore(order) {
  const units = order.units ?? order.totalUnits ?? 0;
  const locations = order.locations ?? order.totalLocations ?? 0;
  return units + locations * 2; // 2 pts per location
}

// Return per-order perf rate (pts/h) based on start/close
function computeOrderPerfRate(order) {
  if (!order.startTime || !order.closeTime) return null;

  const startMs = new Date(order.startTime).getTime();
  const endMs = new Date(order.closeTime).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  const minutes = (endMs - startMs) / 60000;
  if (minutes <= 0) return null;

  const score = computeOrderScore(order);
  return (score / minutes) * 60; // pts/h
}

// Return day-level perf score (pts/h) from archived orders + worked minutes
function computeDayPerfScore(orders, workedMinutes) {
  if (!Array.isArray(orders) || !orders.length) return null;
  if (!workedMinutes || workedMinutes <= 0) return null;

  let totalScore = 0;
  for (const o of orders) {
    totalScore += computeOrderScore(o);
  }

  const workedHours = workedMinutes / 60;
  if (workedHours <= 0) return null;

  return totalScore / workedHours; // pts/h
}