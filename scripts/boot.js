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
