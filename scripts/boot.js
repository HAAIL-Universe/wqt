// Global helper: safe device-id getter used by overlay/role access
function getDeviceIdSafe() {
  try {
    return (
      localStorage.getItem('wqt_device_id') ||
      localStorage.getItem('device_id') ||
      null
    );
  } catch (e) {
    console.warn('[WQT] getDeviceIdSafe failed', e);
    return null;
  }
}

// ====== Auth Guard Function (iOS PWA BFCache Protection) ======
/**
 * enforceAuthGate checks if user is logged in and redirects to login if not.
 * Called on pageshow, visibilitychange, and boot to prevent BFCache resurrection
 * of authenticated tracker UI after logout.
 */
function enforceAuthGate() {
  try {
    // Check forceLogin marker first (set during logout)
    const forceLogin = localStorage.getItem('forceLogin');
    if (forceLogin) {
      console.log('[AuthGate] forceLogin marker detected - redirecting to login');
      window.location.replace('login.html');
      return;
    }

    // Check canonical auth state: WQT_CURRENT_USER with userId
    const raw = localStorage.getItem('WQT_CURRENT_USER');
    if (!raw) {
      console.log('[AuthGate] No WQT_CURRENT_USER - redirecting to login');
      window.location.replace('login.html');
      return;
    }

    let user = null;
    try {
      user = JSON.parse(raw);
    } catch (e) {
      console.warn('[AuthGate] Failed to parse WQT_CURRENT_USER - redirecting to login');
      localStorage.removeItem('WQT_CURRENT_USER');
      window.location.replace('login.html');
      return;
    }

    if (!user || !user.userId) {
      console.log('[AuthGate] WQT_CURRENT_USER missing userId - redirecting to login');
      localStorage.removeItem('WQT_CURRENT_USER');
      window.location.replace('login.html');
      return;
    }

    // User is logged in - allow page to continue
    console.log('[AuthGate] User authenticated:', user.userId);
  } catch (e) {
    console.error('[AuthGate] Exception during auth check:', e);
    // On error, redirect to login for safety
    window.location.replace('login.html');
  }
}

function logoutAndReset() {
  // ====== NEW: Clear in-memory shift state first ======
  // If exitShiftNoArchive exists, call it to wipe all shift-related state and UI
  if (typeof exitShiftNoArchive === 'function') {
    try {
      // Temporarily suppress the alert if current order exists
      const originalCurrent = typeof current !== 'undefined' ? current : null;
      if (typeof current !== 'undefined') current = null;
      
      exitShiftNoArchive();
      console.log('[logout] Cleared shift state via exitShiftNoArchive()');
    } catch (e) {
      console.warn('[logout] exitShiftNoArchive failed:', e);
    }
  }

  // Identity
  localStorage.removeItem('WQT_CURRENT_USER');
  localStorage.removeItem('wqt_operator_id');
  localStorage.removeItem('wqt_username');
  // Core state blobs
  try {
    if (window.Storage && typeof Storage.saveMain === 'function') {
      // Reset namespaced main state to a blank payload (preserves Storage API semantics)
      Storage.saveMain({});
      console.log('[logout] Cleared namespaced main via Storage.saveMain');
    } else {
      localStorage.removeItem('wqt_v2722_data');
    }
  } catch (e) {
    try { localStorage.removeItem('wqt_v2722_data'); } catch(_){}
  }

  try {
    if (window.Storage && typeof Storage.saveLearnedUL === 'function') {
      Storage.saveLearnedUL({});
      console.log('[logout] Cleared namespaced learned UL via Storage.saveLearnedUL');
    } else {
      localStorage.removeItem('wqt_learn_ul');
    }
  } catch (e) {
    try { localStorage.removeItem('wqt_learn_ul'); } catch(_){}
  }

  try {
    if (window.Storage && typeof Storage.saveCustomCodes === 'function') {
      Storage.saveCustomCodes([]);
      console.log('[logout] Cleared namespaced custom codes via Storage.saveCustomCodes');
    } else {
      localStorage.removeItem('wqt_codes');
    }
  } catch (e) {
    try { localStorage.removeItem('wqt_codes'); } catch(_){}
  }

  // Side-channel state (belt-and-suspenders: exitShiftNoArchive should have cleared these)
  localStorage.removeItem('shiftActive');
  localStorage.removeItem('currentOrder');
  localStorage.removeItem('shiftDelays');
  localStorage.removeItem('shiftNotes');
  localStorage.removeItem('breakDraft');
  localStorage.removeItem('sharedBlock');
  localStorage.removeItem('sharedDockOpen');
  localStorage.removeItem('sharedMySum');
  localStorage.removeItem('weekCardCollapsed');
  localStorage.removeItem('proUnlocked');

  console.log('[logout] Full reset complete - redirecting to login');

  // OPTIONAL: reset device identity if you want fresh devices each time
  // localStorage.removeItem('wqt_device_id'); 

  // Set forceLogin marker to prevent BFCache resurrection
  localStorage.setItem('forceLogin', Date.now().toString());

  // Redirect to login screen (use replace to prevent back navigation)
  window.location.replace('login.html');
}

// Convert ISO timestamp to HH:MM local for reconciliation flows
function isoToHHMM(iso){
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  } catch (_) {
    return null;
  }
}

// Minimal reconciliation modal when backend shows an active shift but local UI does not
function showShiftReconcileModal(serverShift){
  const existing = document.getElementById('shiftReconcileModal');
  if (existing) existing.remove();

  // Activate recovery mode so guards don't block termination
  try { enableShiftRecoveryMode?.(serverShift); } catch (_) {}

  const overlay = document.createElement('div');
  overlay.id = 'shiftReconcileModal';
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);z-index:9999;';

  const card = document.createElement('div');
  card.style.cssText = 'background:#0b1220;color:#f8fafc;max-width:420px;padding:20px;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,0.4);font-family:Inter,system-ui,sans-serif;';
  const title = document.createElement('h3');
  title.textContent = 'Active shift found on server';
  title.style.marginTop = '0';

  const body = document.createElement('p');
  const startedHM = isoToHHMM(serverShift?.started_at) || 'unknown';
  body.textContent = `Server shows an active shift started at ${startedHM}. Resume it here or end it on the server.`;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:18px;';

  const resumeBtn = document.createElement('button');
  resumeBtn.textContent = 'Resume shift';
  resumeBtn.className = 'btn';
  resumeBtn.onclick = () => {
    const hhmm = isoToHHMM(serverShift?.started_at) || nowHHMM();
    window.startTime = hhmm;
    try { localStorage.setItem('shiftActive','1'); } catch (_){ }
    persistActiveShiftMeta?.(serverShift || null);
    try { beginShift?.(); } catch(_){ }
    try { clearShiftRecoveryMode?.(); } catch(_){}
    overlay.remove();
  };

  const endBtn = document.createElement('button');
  endBtn.textContent = 'End it now';
  endBtn.className = 'btn ghost';
  endBtn.onclick = async () => {
    try {
      await window.WqtAPI?.endShiftSession?.({
        shiftId: serverShift?.id,
        summary: { start: isoToHHMM(serverShift?.started_at) || '', end: nowHHMM(), picks: [] },
        totalUnits: 0,
        avgRate: null,
        endTime: new Date().toISOString(),
      });
      clearActiveShiftMeta?.();
      exitShiftNoArchive?.();
      showToast?.('Shift closed on server');
    } catch (err) {
      console.error('[Reconcile] Failed to end server shift', err);
      showToast?.('Could not end shift on server. Try again.');
    } finally {
      try { clearShiftRecoveryMode?.(); } catch(_){}
      overlay.remove();
    }
  };

  btnRow.appendChild(resumeBtn);
  btnRow.appendChild(endBtn);

  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(btnRow);
  overlay.appendChild(card);

  overlay.addEventListener('click', (e)=>{
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

// ====== State Rehydration Function ======
/**
 * rehydrateState() - Reload state from localStorage after app resume
 * 
 * This function is called when the page becomes visible again after being
 * backgrounded, to recover from iOS process termination.
 * 
 * Critical: This must run BEFORE any UI updates to prevent showing stale data.
 */
function rehydrateState() {
  try {
    console.log('[Rehydrate] Reloading state from localStorage...');
    
    // Check if loadAll exists (it's defined in core-state-ui.js)
    if (typeof loadAll === 'function') {
      // Reload all state from localStorage
      loadAll();
      console.log('[Rehydrate] State reloaded successfully');
      
      // If we have an active shift or order, update the UI
      const sessionState = typeof getSessionState === 'function' ? getSessionState() : null;
      
      if (sessionState) {
        console.log('[Rehydrate] Session state after reload:', {
          hasActiveShift: sessionState.hasActiveShift,
          hasActiveOrder: sessionState.hasActiveOrder,
          hasCompletedOrders: sessionState.hasCompletedOrders,
        });
        
        // Update UI to reflect rehydrated state
        if (sessionState.hasActiveOrder && typeof restoreActiveOrderUI === 'function') {
          restoreActiveOrderUI();
        }
        
        // Refresh displays
        if (typeof renderHistory === 'function') renderHistory();
        if (typeof renderDone === 'function') renderDone();
        if (typeof updateSummary === 'function') updateSummary();
        if (typeof renderShiftPanel === 'function') renderShiftPanel();
      }
    } else {
      console.warn('[Rehydrate] loadAll function not available yet');
    }
  } catch (e) {
    console.error('[Rehydrate] Failed to rehydrate state:', e);
  }
}

// ====== Forced Persistence on iOS Lifecycle Events ======
/**
 * persistStateOnBackground() - Force save state when page is backgrounded
 * 
 * iOS Safari/PWA often kills background tabs without firing beforeunload.
 * We must persist state immediately when the page becomes hidden.
 */
function persistStateOnBackground() {
  try {
    console.log('[iOS Persist] Page becoming hidden, forcing state save...');
    
    // Force immediate save of all state
    if (typeof saveAll === 'function') {
      saveAll();
      console.log('[iOS Persist] saveAll() completed');
    }
    
    // Also persist critical flags explicitly
    try {
      // Persist shift active flag
      const hasShift = !!(window.startTime || (typeof startTime !== 'undefined' && startTime));
      if (hasShift) {
        localStorage.setItem('shiftActive', '1');
      }
      
      // Persist current order if exists
      const curr = window.current || (typeof current !== 'undefined' ? current : null);
      if (curr && curr.total !== undefined) {
        localStorage.setItem('currentOrder', JSON.stringify(curr));
        console.log('[iOS Persist] Current order snapshot saved');
      }
    } catch (e) {
      console.warn('[iOS Persist] Failed to save critical flags:', e);
    }
    
    console.log('[iOS Persist] State persistence completed');
  } catch (e) {
    console.error('[iOS Persist] Failed to persist state:', e);
  }
}

// ====== iOS PWA BFCache Protection + State Management ======
// Catch iOS BFCache restores with pageshow event
window.addEventListener('pageshow', function(e) {
  console.log('[BFCache] pageshow event fired, persisted:', e.persisted);
  enforceAuthGate();
  
  // If this is a BFCache restore (persisted=true), rehydrate state
  if (e.persisted) {
    console.log('[BFCache] BFCache restore detected, rehydrating state...');
    rehydrateState();
  }
});

// Catch app switch/resume with visibilitychange
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    // Page is being hidden (backgrounded) - persist state immediately
    console.log('[Visibility] Page hidden, persisting state...');
    persistStateOnBackground();
  } else {
    // Page is becoming visible again - check auth and rehydrate state
    console.log('[Visibility] Page visible, checking auth and rehydrating state...');
    enforceAuthGate();
    rehydrateState();
  }
});

// iOS Safari PWA-specific: pagehide event for background persistence
window.addEventListener('pagehide', function(e) {
  console.log('[pagehide] Event fired, persisted:', e.persisted);
  // Force save even if beforeunload didn't fire
  persistStateOnBackground();
});

// ====== Boot ======
document.addEventListener('DOMContentLoaded', function () {
  (async () => {
    try {
      // ── AUTH GATE: Check authentication before any boot logic ────────
      enforceAuthGate();
      
      // Login now handled by front-door (login.html + WQT_CURRENT_USER).
      // If this script is running, gateWqtByLogin has already ensured a user.

      // ── 0) OFFLINE RECOVERY: Sync pending operations first ────────
      if (window.WqtAPI && typeof WqtAPI.syncPendingOps === 'function') {
        try {
          console.log('[Boot] Attempting to sync pending operations...');
          await WqtAPI.syncPendingOps();
        } catch (e) {
          console.warn('[Boot] Pending ops sync failed (will retry when online):', e);
        }
      }

      // ── 1) Try to hydrate from backend (then localStorage) ────────
      if (window.WqtAPI && typeof WqtAPI.loadInitialState === 'function') {
        try {
          // This will:
          //  - GET /api/state
          //  - On success: write into localStorage via Storage.saveMain()
          //  - On failure: fall back to Storage.loadMain()
          await WqtAPI.loadInitialState();
        } catch (e) {
          console.warn('[Boot] Backend load failed, continuing local-only', e);
        }
      }

      // ── 2) Restore persisted state from localStorage ──────────────
      loadCustomCodes();
      loadAll(); // hydrates: startTime, current, tempWraps, picks, historyDays, etc.

      // ── 2b) Get consolidated session state for consistent hydration ──
      const sessionState = typeof getSessionState === 'function' ? getSessionState() : null;
      
      // Use session state if available, otherwise fall back to direct checks
      const hadShift = sessionState ? sessionState.hasActiveShift : !!startTime;
      const hadOpen  = sessionState ? sessionState.hasActiveOrder : !!(current && Number.isFinite(current.total));

      // DEBUG logging for boot state
      console.log('[Boot] Post-loadAll state:', {
        hadShift,
        hadOpen,
        startTime: startTime || 'none',
        currentOrderTotal: current?.total || 'none',
        picksCount: picks?.length || 0,
        shiftActiveFlag: localStorage.getItem('shiftActive'),
      });

      // ── 1b) Reconcile with backend shift session state ──────────
      // CRITICAL FIX: Prevent state wipe when active order exists
      try {
        if (window.WqtAPI?.fetchActiveShiftSession) {
          const res = await WqtAPI.fetchActiveShiftSession();
          const serverShift = res?.shift || null;
          persistActiveShiftMeta?.(serverShift || null);

          const localActive = hadShift || localStorage.getItem('shiftActive') === '1';
          if (serverShift && !localActive) {
            // Server has active shift but local doesn't know → show resume modal
            try { enableShiftRecoveryMode?.(serverShift); } catch(_){}
            showShiftReconcileModal(serverShift);
          } else if (!serverShift && localActive) {
            // FIX: Only clear state if NO active order exists
            // If user has an active order, preserve it (they may have been offline)
            if (!hadOpen) {
              // Safe to clear: no active order in progress
              console.log('[Boot] Server has no shift, clearing local shift state (no active order)');
              exitShiftNoArchive?.();
              showTab?.('tracker');
              // Re-init startTime for fresh shift
              if (!window.startTime) window.startTime = nowHHMM();
            } else {
              // CRITICAL: Active order exists - preserve it even if server lost shift
              console.warn('[Boot] Server has no shift but local has active order - preserving local state');
              // Set shift active flag to match reality
              try { localStorage.setItem('shiftActive', '1'); } catch(_){}
              // Keep user on tracker with their active order visible
              showTab?.('tracker');
            }
          }
        }
      } catch (err) {
        console.warn('[Boot] Active shift check failed:', err);
      }

      // ── 2) Build customer dropdowns (safe post-restore) ───────────
      buildDropdown('oDD','oCust','oOther','o');
      reloadDropdowns();

      // ── 3) Wire modals & inputs ───────────────────────────────────
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

      // ── 4) Pro gate & static renders that don't mutate core state ─
      applyProGate();

      // ── 5) Shift/Order shell visibility based on restored flags ───
      // FIX: Defer card visibility until AFTER reconciliation completes
      // This prevents flashing empty cards if state gets cleared

      const active = document.getElementById('activeOrderCard');
      const done   = document.getElementById('completedCard');
      const shiftLog = document.getElementById('shiftLogCard');

      // Check CURRENT state after reconciliation (may have changed)
      const hasShiftNow = !!(window.startTime || startTime);
      const hasOrderNow = !!(window.current && Number.isFinite(window.current.total));
      
      // DEBUG: Log post-reconciliation state
      console.log('[Boot] Post-reconciliation state:', {
        hasShiftNow,
        hasOrderNow,
        startTime: window.startTime || startTime || 'none',
        currentOrderTotal: window.current?.total || current?.total || 'none',
        stateChanged: (hadShift !== hasShiftNow) || (hadOpen !== hasOrderNow),
      });
      
      // Only show cards if we actually have a shift active
      if (active) active.style.display = hasShiftNow ? 'block' : 'none';
      if (done)   done.style.display   = (hasShiftNow && picks.length) ? 'block' : 'none';
      if (shiftLog) shiftLog.style.display = hasShiftNow ? 'block' : 'none';

      renderShiftPanel?.();

      // ── 6) Decide header: progress vs new-order form ──────────────
      // FIX: Check CURRENT state, not the pre-reconciliation state
      if (hasOrderNow && window.archived !== true) {
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

      // ── 7) Heavy renders AFTER state/UI decision (prevents flips) ─
      renderHistory();
      renderWeeklySummary();
      initWeekCardToggle();
      renderDone();
      renderULayerChips();
      renderShiftPanel?.();

      // ── 8) Start button validation (order of entry agnostic) ──────
      ['oTotal','oOther','order-locations'].forEach(id=>{
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

      // ── 9) Elapsed-only ticker (no rate refresh) ──────────────────
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

      // ── 10) QuickCalc wiring ──────────────────────────────────────
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
      if (typeof refreshSummaryChips === 'function') refreshSummaryChips(); // Ensure chips are in sync with state
      
      // Render role chips to show/hide supervisor and warehouse map tabs
      if (typeof renderRoleChips === 'function') renderRoleChips();

      // Wire Shared Pick bottom bar (padUnits / padSubmit) once DOM is ready
      initSharedPad?.();

      // Persist to localStorage via legacy path
      saveAll?.();

      // NOTE: We do NOT auto-save to backend on load per offline recovery design.
      // MainState is only POSTed for explicit actions (start order, log wrap, etc.).
      // Archives are handled separately via the pending ops queue.
    } catch (err) {
      console.error(err);
      showToast('Error on load: ' + (err.message || err));
    }
  })();
});

// ====== Global Network Listener (Offline Recovery) ======
// Automatically sync pending operations when device comes back online
window.addEventListener('online', function() {
  console.log('[WQT] Device is back online, syncing pending operations...');
  if (window.WqtAPI && typeof WqtAPI.syncPendingOps === 'function') {
    WqtAPI.syncPendingOps().catch(err => {
      console.warn('[WQT] Auto-sync on reconnect failed:', err);
    });
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

  // Track wrap start time for duration calculation
  if (!current.wrapActive) {
    current.wrapActive = {
      startTime: nowHHMM(),
      startTs: Date.now()
    };
  }

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
  
  // Clear wrap active state if canceling
  if (current && current.wrapActive) {
    delete current.wrapActive;
  }
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

// --- Message Poller (NEW) ---
// Checks for admin messages every 30 seconds
setInterval(async function pollForMessages() {
  // Safe check for device ID getter (from api.js scope or window)
  const getID = (typeof getDeviceId === 'function') ? getDeviceId 
              : (window.WqtAPI && window.WqtAPI.getDeviceId) ? window.WqtAPI.getDeviceId : null;
  
  if (!getID) return; // Not ready yet

  // If we have a custom fetch helper, use it; else generic fetch
  const doFetch = (typeof fetchJSON === 'function') ? fetchJSON : null; 
  if (!doFetch) return; // Wait for api.js

  // Actually get the ID
  let devId = null;
  try { devId = getID(); } catch(e){}
  if (!devId) return;

  try {
    // If you used the `fetchJSON` helper, it likely prepends API_BASE automatically
    // But here we might just raw fetch to be safe or use the helper if exported.
    
    // Simplest: use raw fetch with the same base you used in api.js
    // We'll guess API_BASE or assume relative path / proxy.
    // If `API_BASE` is global, use it.
    const baseUrl = (typeof API_BASE !== 'undefined') ? API_BASE : 'https://wqt-backend.onrender.com';
    
    const res = await fetch(`${baseUrl}/api/messages/check?device-id=${encodeURIComponent(devId)}`);
    if (res.ok) {
        const messages = await res.json();
        if (Array.isArray(messages) && messages.length > 0) {
            messages.forEach(msg => {
                // Simple Alert for now
                alert("🔔 SUPERVISOR MESSAGE:\n\n" + msg);
            });
        }
    }
  } catch (e) {
    // Silent fail
  }
}, 30000); // 30s

// ====== Auth / Login helpers ======

function ensureAuthOnBoot() {
  try {
    // getLoggedInUser is defined in api.js and exposed globally
    const hasUser = (typeof getLoggedInUser === 'function')
      ? getLoggedInUser()
      : null;

    const opId = (typeof window !== 'undefined' && window.localStorage)
      ? window.localStorage.getItem('wqt_operator_id')
      : null;

    // If we already know the user (or have an operator id), don't block boot.
    if ((hasUser && String(hasUser).trim()) || (opId && opId.trim())) {
      return;
    }

    // Brand new device + user: show the login modal if present.
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
      loginModal.style.display = 'flex';
      const uEl = document.getElementById('loginUsername');
      if (uEl) uEl.focus();
    } else {
      // Fallback to legacy "Who is picking?" modal.
      const opModal = document.getElementById('operatorIdModal');
      if (opModal) opModal.style.display = 'flex';
    }
  } catch (e) {
    console.warn('[Boot] ensureAuthOnBoot error:', e);
  }
}

async function loginSubmit(mode) {
  if (!window.WqtAPI || typeof WqtAPI.login !== 'function' || typeof WqtAPI.register !== 'function') {
    alert('Login is not available (backend offline).');
    return;
  }

  const uEl = document.getElementById('loginUsername');
  const pEl = document.getElementById('loginPin');
  const username = (uEl?.value || '').trim();
  const pin = (pEl?.value || '').trim();

  if (!username) {
    alert('Enter your Operator ID.');
    if (uEl) uEl.focus();
    return;
  }
  if (!pin || pin.length < 4) {
    alert('Enter your 4-digit PIN.');
    if (pEl) pEl.focus();
    return;
  }

  try {
    const fn = mode === 'register' ? WqtAPI.register : WqtAPI.login;
    const res = await fn(username, pin);
    if (!res || !res.success) {
      alert(res?.message || (mode === 'register' ? 'Registration failed.' : 'Login failed.'));
      return;
    }

    // Mirror into the legacy operator-id key so the rest of the app sees it.
    try {
      localStorage.setItem('wqt_operator_id', res.username);
    } catch (e) {
      console.warn('[Auth] Failed to persist operator id:', e);
    }

    // Close modals
    const loginModal = document.getElementById('loginModal');
    if (loginModal) loginModal.style.display = 'none';

    const opModal = document.getElementById('operatorIdModal');
    if (opModal) opModal.style.display = 'none';

    if (typeof showToast === 'function') {
      showToast(`Signed in as ${res.username}`);
    }

    // Trigger a save so the backend gets the new user-id key immediately.
    if (typeof saveAll === 'function') {
      try { saveAll(); } catch (e) { console.warn('[Auth] saveAll after login failed:', e); }
    }
  } catch (e) {
    console.error('[Auth] Login/register error:', e);
    alert('Login failed – please try again.');
  }
}

function loginAsGuest() {
  const loginModal = document.getElementById('loginModal');
  if (loginModal) loginModal.style.display = 'none';

  const opModal = document.getElementById('operatorIdModal');
  if (opModal) {
    opModal.style.display = 'flex';
    const inp = document.getElementById('opIdInput');
    if (inp) inp.focus();
  }
}

// ====== Storage Telemetry Debug UI ======
function openStorageTelemetryModal() {
  const modal = document.getElementById('storageTelemetryModal');
  const output = document.getElementById('telemetryOutput');
  
  if (!modal || !output) {
    alert('Telemetry modal not found');
    return;
  }
  
  // Refresh telemetry output
  if (typeof window !== 'undefined' && window.StorageTelemetry) {
    output.textContent = StorageTelemetry.dump();
  } else {
    output.textContent = '[Error] StorageTelemetry not initialized';
  }
  
  modal.style.display = 'flex';
}

if (typeof window !== 'undefined') {
  window.openStorageTelemetryModal = openStorageTelemetryModal;
}

