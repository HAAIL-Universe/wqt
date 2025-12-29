(function () {
  const TOUR_VERSION = 1;
  const STORAGE_PREFIX = `wqt_tour_v${TOUR_VERSION}`;
  const STATE_DEFAULTS = { status: 'inactive', stepIndex: 0, updatedAt: 0 };

  const steps = [
    {
      id: 'shift-start',
      title: 'Start your shift',
      body: 'Tap Start shift to begin.',
      selector: '[data-tour="shift-start"]',
      advanceOn: { click: true, events: ['tour:shift-started'] },
      precheck: () => isShiftActive()
    },
    {
      id: 'customer-select',
      title: 'Select a customer',
      body: 'Open the customer selector and choose a code.',
      selector: '[data-tour="customer-select"]',
      advanceOn: { events: ['tour:customer-selected', 'tour:customer-created'] }
    },
    {
      id: 'units-input',
      title: 'Enter total units',
      body: 'Type the total units for this order.',
      selector: '[data-tour="units-input"]'
    },
    {
      id: 'locations-input',
      title: 'Enter locations',
      body: 'Type the number of locations for this order.',
      selector: '[data-tour="locations-input"]',
      onShow: () => focusLocationsInput()
    },
    {
      id: 'order-start',
      title: 'Start the order',
      body: 'Tap Start to begin picking.',
      selector: '[data-tour="order-start"]',
      advanceOn: { click: true, events: ['tour:order-started'] },
      precheck: () => isOrderActive()
    },
    {
      id: 'wrap-open',
      title: 'Log a wrap',
      body: 'Open Log Wrap when you finish a pallet.',
      selector: '[data-tour="wrap-open"]',
      advanceOn: { click: true },
      advanceOnModal: '#wrapModal',
      optional: true
    },
    {
      id: 'wrap-submit',
      title: 'Save wrap',
      body: 'Enter units left and Save Wrap.',
      selector: '[data-tour="wrap-submit"]',
      advanceOn: { events: ['tour:wrap-logged'] },
      optional: true
    }
  ];

  let state = loadState();
  let overlay;
  let tooltip;
  let tooltipTitle;
  let tooltipBody;
  let tooltipCount;
  let btnNext;
  let btnSkip;
  let btnLater;
  let btnNever;
  let actionsWrap;
  let actionsBase;
  let nextBase;
  let maskTop;
  let maskBottom;
  let maskLeft;
  let maskRight;
  let highlight;
  let currentStep = null;
  let activeTarget = null;
  let waitingTimer = null;
  let modalWatchTimer = null;
  let positionTimer = null;
  let activeListeners = [];
  let advancing = false;

  (function initTourDebugFlag(){
    let enabled = false;
    try {
      const params = new URL(window.location.href).searchParams.getAll('debug');
      enabled = params.indexOf('tour') !== -1;
    } catch (e) {}
    if (window.__WQT_DEBUG_TOUR) enabled = true;
    if (enabled) window.__TOUR_DEBUG = true;
  })();

  function log() {
    if (!window.__TOUR_DEBUG) return;
    const args = Array.prototype.slice.call(arguments);
    console.log.apply(console, ['[tour]'].concat(args));
  }

  function rectToObj(rect) {
    if (!rect) return null;
    return {
      x: rect.x,
      y: rect.y,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }

  function describeEl(el) {
    if (!el) return null;
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      id: el.id || null,
      dataTour: el.getAttribute ? el.getAttribute('data-tour') : null
    };
  }

  function getUserId() {
    try {
      const raw = localStorage.getItem('WQT_CURRENT_USER');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && (obj.userId || obj.username || obj.id)) {
          return String(obj.userId || obj.username || obj.id);
        }
      }
    } catch (e) {}
    try {
      return (
        localStorage.getItem('wqt_operator_id') ||
        localStorage.getItem('wqt_username') ||
        null
      );
    } catch (e) {
      return null;
    }
  }

  function getDeviceId() {
    try {
      return localStorage.getItem('wqt_device_id') || localStorage.getItem('device_id') || null;
    } catch (e) {
      return null;
    }
  }

  function getStorageKey() {
    const userId = getUserId();
    if (userId) return `${STORAGE_PREFIX}__u_${userId}`;
    const deviceId = getDeviceId();
    if (deviceId) return `${STORAGE_PREFIX}__d_${deviceId}`;
    return `${STORAGE_PREFIX}__anon`;
  }

  function loadState() {
    const key = getStorageKey();
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { ...STATE_DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...STATE_DEFAULTS, ...parsed };
    } catch (e) {
      return { ...STATE_DEFAULTS };
    }
  }

  function saveState(next) {
    const key = getStorageKey();
    const payload = { ...next, updatedAt: Date.now() };
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {}
    return payload;
  }

  function setState(patch) {
    state = saveState({ ...state, ...patch });
  }

  function isShiftActive() {
    return !!(window.startTime || localStorage.getItem('shiftActive') === '1');
  }

  function isOrderActive() {
    return !!(window.current && Number.isFinite(window.current.total));
  }

  function isPositiveInt(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0;
  }

  function focusLocationsInput() {
    const el = document.getElementById('order-locations');
    if (!el) return;
    try { el.focus(); } catch (e) {}
    try { el.click(); } catch (e) {}
  }

  function getTourParams() {
    try {
      return new URL(window.location.href).searchParams.getAll('tour');
    } catch (e) {
      return [];
    }
  }

  function hasTourParam() {
    return getTourParams().indexOf('1') !== -1;
  }

  function hasTourForceParam() {
    const params = getTourParams();
    return params.indexOf('force') !== -1 || params.indexOf('reset') !== -1;
  }

  function getStepIndex(id) {
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].id === id) return i;
    }
    return 0;
  }

  function getInputValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  function getStartIndexFromUI() {
    const customer = getInputValue('oCust');
    if (!customer) return getStepIndex('customer-select');
    const units = getInputValue('oTotal');
    if (!isPositiveInt(units)) return getStepIndex('units-input');
    const locations = getInputValue('order-locations');
    if (!isPositiveInt(locations)) return getStepIndex('locations-input');
    return getStepIndex('order-start');
  }

  function ensureUI() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'tourOverlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '10001';
    overlay.style.pointerEvents = 'none';
    overlay.style.display = 'none';

    maskTop = createMask();
    maskBottom = createMask();
    maskLeft = createMask();
    maskRight = createMask();
    highlight = document.createElement('div');
    highlight.style.position = 'fixed';
    highlight.style.border = '2px solid rgba(255,255,255,0.9)';
    highlight.style.borderRadius = '10px';
    highlight.style.boxShadow = '0 0 0 2px rgba(0,0,0,0.2)';
    highlight.style.pointerEvents = 'none';
    highlight.style.zIndex = '10002';

    tooltip = document.createElement('div');
    tooltip.style.position = 'fixed';
    tooltip.style.zIndex = '10003';
    tooltip.style.pointerEvents = 'auto';
    tooltip.style.maxWidth = '320px';
    tooltip.style.background = '#101722';
    tooltip.style.color = '#e6edf6';
    tooltip.style.border = '1px solid #233044';
    tooltip.style.borderRadius = '12px';
    tooltip.style.boxShadow = '0 14px 35px rgba(0,0,0,0.5)';
    tooltip.style.padding = '12px';
    tooltip.style.fontFamily = 'system-ui, -apple-system, Segoe UI, sans-serif';

    tooltipTitle = document.createElement('div');
    tooltipTitle.style.fontWeight = '700';
    tooltipTitle.style.marginBottom = '6px';

    tooltipBody = document.createElement('div');
    tooltipBody.style.fontSize = '13px';
    tooltipBody.style.lineHeight = '1.4';
    tooltipBody.style.marginBottom = '10px';

    tooltipCount = document.createElement('div');
    tooltipCount.style.fontSize = '11px';
    tooltipCount.style.opacity = '0.7';
    tooltipCount.style.marginBottom = '8px';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.flexWrap = 'wrap';
    actions.style.justifyContent = 'flex-end';
    actionsWrap = actions;

    btnLater = createActionButton('Later');
    btnSkip = createActionButton('Skip');
    btnNever = createActionButton("Don't show again");
    btnNext = createActionButton('Next', true);

    actions.appendChild(btnLater);
    actions.appendChild(btnSkip);
    actions.appendChild(btnNever);
    actions.appendChild(btnNext);

    tooltip.appendChild(tooltipTitle);
    tooltip.appendChild(tooltipBody);
    tooltip.appendChild(tooltipCount);
    tooltip.appendChild(actions);

    overlay.appendChild(maskTop);
    overlay.appendChild(maskBottom);
    overlay.appendChild(maskLeft);
    overlay.appendChild(maskRight);
    overlay.appendChild(highlight);
    overlay.appendChild(tooltip);

    document.body.appendChild(overlay);

    btnNext.addEventListener('click', advanceStep);
    btnSkip.addEventListener('click', skipTour);
    btnLater.addEventListener('click', pauseTour);
    btnNever.addEventListener('click', skipTour);

    applyActionLayout();
    window.addEventListener('resize', applyActionLayout);
  }

  function createMask() {
    const mask = document.createElement('div');
    mask.style.position = 'fixed';
    mask.style.background = 'rgba(4, 8, 16, 0.55)';
    mask.style.pointerEvents = 'auto';
    mask.style.zIndex = '10001';
    return mask;
  }

  function createActionButton(text, primary) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.border = '1px solid #2a3a55';
    btn.style.borderRadius = '8px';
    btn.style.padding = '6px 10px';
    btn.style.fontSize = '12px';
    btn.style.cursor = 'pointer';
    btn.style.background = primary ? '#22c55e' : '#0f172a';
    btn.style.color = primary ? '#0b1220' : '#e5e7eb';
    return btn;
  }

  function applyActionLayout() {
    if (!actionsWrap || !btnNext) return;
    if (!actionsBase) {
      actionsBase = {
        flexDirection: actionsWrap.style.flexDirection || '',
        alignItems: actionsWrap.style.alignItems || '',
        justifyContent: actionsWrap.style.justifyContent || ''
      };
    }
    if (!nextBase) {
      nextBase = {
        width: btnNext.style.width || '',
        padding: btnNext.style.padding || '',
        fontSize: btnNext.style.fontSize || '',
        fontWeight: btnNext.style.fontWeight || '',
        order: btnNext.style.order || ''
      };
    }
    const isMobile = (window.matchMedia && window.matchMedia('(max-width: 520px)').matches) || window.innerWidth <= 520;
    if (isMobile) {
      actionsWrap.style.flexDirection = 'column';
      actionsWrap.style.alignItems = 'stretch';
      actionsWrap.style.justifyContent = 'stretch';
      btnNext.style.width = '100%';
      btnNext.style.padding = '10px 12px';
      btnNext.style.fontSize = '14px';
      btnNext.style.fontWeight = '700';
      btnNext.style.order = '10';
      return;
    }
    actionsWrap.style.flexDirection = actionsBase.flexDirection;
    actionsWrap.style.alignItems = actionsBase.alignItems;
    actionsWrap.style.justifyContent = actionsBase.justifyContent;
    btnNext.style.width = nextBase.width;
    btnNext.style.padding = nextBase.padding;
    btnNext.style.fontSize = nextBase.fontSize;
    btnNext.style.fontWeight = nextBase.fontWeight;
    btnNext.style.order = nextBase.order;
  }

  function showOverlay() {
    if (!overlay) return;
    overlay.style.display = 'block';
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.style.display = 'none';
  }

  function setTooltipContent(step) {
    tooltipTitle.textContent = step.title || '';
    tooltipBody.textContent = step.body || '';
    const count = `${state.stepIndex + 1}/${steps.length}`;
    tooltipCount.textContent = `Step ${count}`;
    btnNext.textContent = state.stepIndex >= steps.length - 1 ? 'Finish' : 'Next';
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false;
    return true;
  }

  function findVisibleAncestor(el) {
    let node = el && el.parentElement;
    while (node) {
      if (isVisible(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function getStepTarget(step) {
    if (!step) return null;
    if (step.id === 'customer-select') {
      const modal = document.querySelector('[data-tour="customer-modal"]');
      if (modal && isVisible(modal) && window.getComputedStyle(modal).display !== 'none') {
        return modal;
      }
      const primary = document.querySelector(step.selector);
      if (isVisible(primary)) return primary;
      if (primary) {
        const child = primary.querySelector('input,button,select,textarea');
        if (isVisible(child)) return child;
        const fallback = findVisibleAncestor(primary);
        if (fallback) return fallback;
      }
    }
    if (step.id === 'wrap-submit') {
      const wrapModal = document.getElementById('wrapModal');
      if (wrapModal && isVisible(wrapModal) && window.getComputedStyle(wrapModal).display !== 'none') {
        return wrapModal;
      }
    }
    const target = document.querySelector(step.selector);
    if (step.id === 'wrap-open' && window.__TOUR_DEBUG) {
      log('wrap-open target', {
        selector: step.selector,
        target: describeEl(target),
        rect: rectToObj(target ? target.getBoundingClientRect() : null)
      });
    }
    return target;
  }

  function waitForTarget(step) {
    clearTimers();
    hideOverlay();
    activeTarget = null;
    const started = Date.now();
    let lastLog = 0;
    const poll = () => {
      if (state.status !== 'active') return;
      const el = getStepTarget(step);
      if (el && isVisible(el)) {
        activateStep(step, el);
        return;
      }
      if (Date.now() - started > 5000 && Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        log('waiting for', step.id, step.selector);
      }
      waitingTimer = setTimeout(poll, 300);
    };
    poll();
  }

  function activateStep(step, el) {
    currentStep = step;
    activeTarget = el;
    ensureUI();
    setTooltipContent(step);
    showOverlay();
    positionAll();
    bindAdvanceHandlers(step, el);
    if (step.onShow) {
      setTimeout(() => {
        try { step.onShow(el); } catch (e) {}
      }, 0);
    }
    log('step', step.id);
  }

  function bindAdvanceHandlers(step, el) {
    cleanupListeners();

    if (step.advanceOn && step.advanceOn.click) {
      const onClick = () => advanceStep();
      el.addEventListener('click', onClick, { once: true });
      activeListeners.push({ el, type: 'click', fn: onClick });
    }

    if (step.advanceOn && step.advanceOn.inputValid) {
      const onInput = (ev) => {
        if (step.advanceOn.inputValid(ev.target.value)) {
          advanceStep();
        }
      };
      el.addEventListener('input', onInput);
      activeListeners.push({ el, type: 'input', fn: onInput });
    }

    if (step.advanceOn && Array.isArray(step.advanceOn.events)) {
      step.advanceOn.events.forEach((evt) => {
        const onEvt = () => advanceStep();
        window.addEventListener(evt, onEvt, { once: true });
        activeListeners.push({ el: window, type: evt, fn: onEvt });
      });
    }

    if (step.id === 'units-input') {
      const onKey = (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        advanceStep();
        setTimeout(focusLocationsInput, 50);
      };
      el.addEventListener('keydown', onKey);
      activeListeners.push({ el, type: 'keydown', fn: onKey });
    }

    if (step.id === 'locations-input') {
      const onKey = (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        advanceStep();
      };
      el.addEventListener('keydown', onKey);
      activeListeners.push({ el, type: 'keydown', fn: onKey });
    }

    if (step.id === 'customer-select') {
      const onClick = () => setTimeout(positionAll, 200);
      el.addEventListener('click', onClick);
      activeListeners.push({ el, type: 'click', fn: onClick });
    }

    if (step.advanceOnModal) {
      watchModalOpen(step.advanceOnModal);
    }

    const onScroll = () => positionAll();
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    activeListeners.push({ el: window, type: 'resize', fn: onScroll });
    activeListeners.push({ el: window, type: 'scroll', fn: onScroll, opts: true });
  }

  function cleanupListeners() {
    activeListeners.forEach((listener) => {
      try {
        listener.el.removeEventListener(listener.type, listener.fn, listener.opts || undefined);
      } catch (e) {}
    });
    activeListeners = [];
  }

  function watchModalOpen(selector) {
    clearModalWatch();
    const poll = () => {
      if (state.status !== 'active' || !currentStep || currentStep.advanceOnModal !== selector) return;
      const el = document.querySelector(selector);
      if (el && isVisible(el) && window.getComputedStyle(el).display !== 'none') {
        advanceStep();
        return;
      }
      modalWatchTimer = setTimeout(poll, 250);
    };
    poll();
  }

  function clearModalWatch() {
    if (modalWatchTimer) clearTimeout(modalWatchTimer);
    modalWatchTimer = null;
  }

  function clearTimers() {
    if (waitingTimer) clearTimeout(waitingTimer);
    waitingTimer = null;
    clearModalWatch();
    if (positionTimer) cancelAnimationFrame(positionTimer);
    positionTimer = null;
  }

  function positionAll() {
    if (!activeTarget || !currentStep) return;
    const dynamicTarget = getStepTarget(currentStep);
    if (dynamicTarget && dynamicTarget !== activeTarget) {
      activeTarget = dynamicTarget;
    }
    if (!isVisible(activeTarget)) {
      waitForTarget(currentStep);
      return;
    }
    const rect = activeTarget.getBoundingClientRect();
    positionMasks(rect);
    positionHighlight(rect);
    positionTooltip(rect);
    if (window.__TOUR_DEBUG && currentStep && currentStep.id === 'wrap-open') {
      log('wrap-open overlay', {
        selector: currentStep.selector,
        target: describeEl(activeTarget),
        targetRect: rectToObj(rect),
        overlayRect: rectToObj(highlight ? highlight.getBoundingClientRect() : null)
      });
    }
  }

  function positionMasks(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const topH = Math.max(0, rect.top);
    const bottomH = Math.max(0, vh - rect.bottom);
    const leftW = Math.max(0, rect.left);
    const rightW = Math.max(0, vw - rect.right);

    maskTop.style.left = '0px';
    maskTop.style.top = '0px';
    maskTop.style.width = '100%';
    maskTop.style.height = `${topH}px`;

    maskBottom.style.left = '0px';
    maskBottom.style.top = `${rect.bottom}px`;
    maskBottom.style.width = '100%';
    maskBottom.style.height = `${bottomH}px`;

    maskLeft.style.left = '0px';
    maskLeft.style.top = `${rect.top}px`;
    maskLeft.style.width = `${leftW}px`;
    maskLeft.style.height = `${Math.max(0, rect.height)}px`;

    maskRight.style.left = `${rect.right}px`;
    maskRight.style.top = `${rect.top}px`;
    maskRight.style.width = `${rightW}px`;
    maskRight.style.height = `${Math.max(0, rect.height)}px`;
  }

  function positionHighlight(rect) {
    const pad = 4;
    highlight.style.left = `${Math.max(0, rect.left - pad)}px`;
    highlight.style.top = `${Math.max(0, rect.top - pad)}px`;
    highlight.style.width = `${Math.max(0, rect.width + pad * 2)}px`;
    highlight.style.height = `${Math.max(0, rect.height + pad * 2)}px`;
  }

  function positionTooltip(rect) {
    tooltip.style.visibility = 'hidden';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 10;
    const tooltipRect = tooltip.getBoundingClientRect();
    const rectRight = rect.left + rect.width;
    const rectBottom = rect.top + rect.height;
    const spaceAbove = rect.top - margin;
    const spaceBelow = vh - rectBottom - margin;
    const preferBelow = spaceBelow >= spaceAbove;
    let top = rect.bottom + margin;
    if (spaceBelow >= tooltipRect.height) {
      top = rect.bottom + margin;
    } else if (spaceAbove >= tooltipRect.height) {
      top = rect.top - tooltipRect.height - margin;
    } else {
      top = (spaceBelow >= spaceAbove)
        ? rect.bottom + margin
        : rect.top - tooltipRect.height - margin;
    }
    if (top < margin) top = margin;
    if (top + tooltipRect.height > vh - margin) {
      top = Math.max(margin, vh - tooltipRect.height - margin);
    }
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    left = Math.max(margin, Math.min(left, vw - tooltipRect.width - margin));
    const overlaps = (l, t) => {
      const r = l + tooltipRect.width;
      const b = t + tooltipRect.height;
      return !(r < rect.left || l > rectRight || b < rect.top || t > rectBottom);
    };
    if (overlaps(left, top)) {
      const altTop = preferBelow ? rect.top - tooltipRect.height - margin : rectBottom + margin;
      let altTopClamped = altTop;
      if (altTopClamped < margin) altTopClamped = margin;
      if (altTopClamped + tooltipRect.height > vh - margin) {
        altTopClamped = Math.max(margin, vh - tooltipRect.height - margin);
      }
      if (!overlaps(left, altTopClamped)) {
        top = altTopClamped;
      } else {
        const rightPos = rectRight + margin;
        const leftPos = rect.left - tooltipRect.width - margin;
        if (rightPos + tooltipRect.width <= vw - margin) left = rightPos;
        else if (leftPos >= margin) left = leftPos;
      }
    }
    let finalTop = top;
    let finalLeft = left;
    if (overlaps(finalLeft, finalTop)) {
      const candidates = [
        { left: margin, top: margin },
        { left: vw - tooltipRect.width - margin, top: margin },
        { left: margin, top: vh - tooltipRect.height - margin },
        { left: vw - tooltipRect.width - margin, top: vh - tooltipRect.height - margin }
      ].filter(pos =>
        pos.left >= margin &&
        pos.top >= margin &&
        pos.left + tooltipRect.width <= vw - margin &&
        pos.top + tooltipRect.height <= vh - margin
      );
      const next = candidates.find(pos => !overlaps(pos.left, pos.top));
      if (next) {
        finalTop = next.top;
        finalLeft = next.left;
      }
    }
    tooltip.style.top = `${finalTop}px`;
    tooltip.style.left = `${finalLeft}px`;
    tooltip.style.visibility = 'visible';
  }

  function advanceStep() {
    if (advancing) return;
    advancing = true;
    clearTimers();
    cleanupListeners();
    const nextIndex = state.stepIndex + 1;
    if (nextIndex >= steps.length) {
      completeTour();
      advancing = false;
      return;
    }
    setState({ stepIndex: nextIndex, status: 'active' });
    advancing = false;
    showStep(nextIndex);
  }

  function showStep(index) {
    if (index >= steps.length) {
      completeTour();
      return;
    }
    const step = steps[index];
    if (step.precheck && step.precheck()) {
      advanceStep();
      return;
    }
    waitForTarget(step);
  }

  function startTour() {
    setState({ status: 'active', stepIndex: 0 });
    showStep(0);
  }

  function startTourAt(index) {
    setState({ status: 'active', stepIndex: index });
    showStep(index);
  }

  function resetTour() {
    clearTimers();
    cleanupListeners();
    hideOverlay();
    try {
      localStorage.removeItem(getStorageKey());
    } catch (e) {}
    state = { ...STATE_DEFAULTS };
    log('reset');
  }

  function forceStartTour(index) {
    clearTimers();
    cleanupListeners();
    hideOverlay();
    const targetIndex = Number.isFinite(index) ? index : getStartIndexFromUI();
    startTourAt(targetIndex);
  }

  function pauseTour() {
    setState({ status: 'paused' });
    hideOverlay();
    clearTimers();
    cleanupListeners();
    log('paused');
  }

  function skipTour() {
    setState({ status: 'skipped' });
    hideOverlay();
    clearTimers();
    cleanupListeners();
    log('skipped');
  }

  function completeTour() {
    setState({ status: 'completed' });
    hideOverlay();
    clearTimers();
    cleanupListeners();
    log('completed');
  }

  function resumeTour() {
    setState({ status: 'active' });
    showStep(state.stepIndex || 0);
  }

  function init() {
    const api = {
      start: startTour,
      reset: resetTour,
      forceStart: forceStartTour,
      resume: resumeTour,
      positionAll: positionAll,
      pause: pauseTour,
      skip: skipTour
    };
    window.Tour = api;
    window.WqtTour = api;

    if (hasTourParam()) {
      const forceStart = hasTourForceParam() || window.__TOUR_RESET === true;
      if (!forceStart && (state.status === 'completed' || state.status === 'skipped')) return;
      if (state.status === 'active') {
        showStep(state.stepIndex || 0);
      } else {
        startTourAt(getStartIndexFromUI());
      }
      return;
    }

    window.addEventListener('tour:shift-started', () => {
      if (state.status === 'completed' || state.status === 'skipped') return;
      forceStartTour(getStepIndex('customer-select'));
    });

    if (state.status === 'active') {
      showStep(state.stepIndex || 0);
    } else if (state.status === 'paused' && window.__TOUR_DEBUG) {
      resumeTour();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
