// /scripts/storage.js
// Centralised localStorage wrapper for WQT.
// This mirrors the *existing* QC-Tracker schema so we can
// gradually route all persistence through here and later
// swap to a real backend without changing the rest of the app.

// Core keys – must match bootstrap.js
const STORAGE_KEY_MAIN  = 'wqt_v2722_data';   // == KEY
const STORAGE_KEY_LEARN = 'wqt_learn_ul';     // == KEY_LEARN
const STORAGE_KEY_CODES = 'wqt_codes';        // == KEY_CODES

// Side-channel keys used directly in bootstrap.js
// (delays, notes, shared pick, snake, etc.)
const StorageKeys = {
  SHIFT_ACTIVE:        'shiftActive',        // "1"/"0" flag
  CURRENT_ORDER:       'currentOrder',       // JSON blob for active order
  SHIFT_DELAYS:        'shiftDelays',        // JSON array [{type:'D',...}]
  SHIFT_NOTES:         'shiftNotes',         // JSON array [{t,note,op?}]
  BREAK_DRAFT:         'breakDraft',         // JSON draft for open break
  SHARED_BLOCK:        'sharedBlock',        // JSON shared order meta
  SHARED_DOCK_OPEN:    'sharedDockOpen',     // "1"/"0" dock open flag
  SHARED_MY_SUM:       'sharedMySum',        // JSON summary for my units
  SNAKE_DELAY_DRAFT:   'snakeDelayDraft',    // JSON snake delay draft
  SNAKE_DELAY_DONE:    'snakeDelayCompleted',// JSON snake delay commit
  SNAKE_LIVE_RATE:     'snakeLiveRateUh',    // stringified number (u/h)
  WEEK_CARD_COLLAPSED: 'weekCardCollapsed',  // "1"/"0" for history UI
  PRO_UNLOCKED_FLAG:   'proUnlocked'         // legacy one-off pro gate
};

const STORAGE_VERSION = '3.3.55'; // matches existing schema tag

function safeParse(json, fallback) {
  try {
    if (!json) return fallback;
    return JSON.parse(json);
  } catch (_) {
    return fallback;
  }
}

const Storage = {
  // ---- Core state blob (picks, history, current, etc.) ----
  // This mirrors loadAll/saveAll in bootstrap.js.
  loadMain() {
    const raw = window.localStorage.getItem(STORAGE_KEY_MAIN);
    const parsed = safeParse(raw, null);

    if (!parsed) {
      // Sane defaults (same as bootstrap.js loadAll)
      return {
        version: STORAGE_VERSION,
        savedAt: null,
        picks: [],
        history: [],
        current: null,
        tempWraps: [],
        startTime: '',
        lastClose: '',
        pickingCutoff: '',
        undoStack: [],
        proUnlocked: false,
        snakeUnlocked: false,
        shiftBreaks: [],
        operativeLog: [],
        operativeActive: null
      };
    }

    // Normalise shape so callers get stable fields
    const p = parsed;
    return {
      version: p.version || STORAGE_VERSION,
      savedAt: p.savedAt || null,
      picks: Array.isArray(p.picks) ? p.picks : [],
      history: Array.isArray(p.history) ? p.history : [],
      current: p.current || null,
      tempWraps: Array.isArray(p.tempWraps) ? p.tempWraps : [],
      startTime: typeof p.startTime === 'string' ? p.startTime : '',
      lastClose: typeof p.lastClose === 'string' ? p.lastClose : '',
      pickingCutoff: typeof p.pickingCutoff === 'string' ? p.pickingCutoff : '',
      undoStack: Array.isArray(p.undoStack) ? p.undoStack : [],
      proUnlocked: !!p.proUnlocked,
      snakeUnlocked: !!p.snakeUnlocked,
      shiftBreaks: Array.isArray(p.shiftBreaks) ? p.shiftBreaks : [],
      operativeLog: Array.isArray(p.operativeLog) ? p.operativeLog : [],
      operativeActive: p.operativeActive || null
    };
  },

  saveMain(state) {
    try {
      const s = state || {};
      const payload = {
        version: STORAGE_VERSION,               // keep schema tag
        savedAt: new Date().toISOString(),
        picks: s.picks || [],
        history: s.history || [],
        current: s.current || null,
        tempWraps: s.tempWraps || [],
        startTime: s.startTime || '',
        lastClose: s.lastClose || '',
        pickingCutoff: s.pickingCutoff || '',
        undoStack: s.undoStack || [],
        proUnlocked: !!s.proUnlocked,
        snakeUnlocked: !!s.snakeUnlocked,
        shiftBreaks: s.shiftBreaks || [],
        operativeLog: s.operativeLog || [],
        operativeActive: s.operativeActive || null
      };

      window.localStorage.setItem(
        STORAGE_KEY_MAIN,
        JSON.stringify(payload)
      );
    } catch (e) {
      console.error('Storage.saveMain failed', e);
    }
  },

  // ---- Learned UL ----
  loadLearnedUL() {
    const raw = window.localStorage.getItem(STORAGE_KEY_LEARN);
    return safeParse(raw, {}) || {};
  },

  saveLearnedUL(learned) {
    try {
      window.localStorage.setItem(
        STORAGE_KEY_LEARN,
        JSON.stringify(learned || {})
      );
    } catch (e) {
      console.error('Storage.saveLearnedUL failed', e);
    }
  },

  // ---- Custom store codes ----
  loadCustomCodes() {
    const raw = window.localStorage.getItem(STORAGE_KEY_CODES);
    return safeParse(raw, []) || [];
  },

  saveCustomCodes(codes) {
    try {
      window.localStorage.setItem(
        STORAGE_KEY_CODES,
        JSON.stringify(codes || [])
      );
    } catch (e) {
      console.error('Storage.saveCustomCodes failed', e);
    }
  },

  // ---- Generic helpers for one-off flags / JSON blobs ----
  getFlag(key) {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  },

  setFlag(key, on) {
    try {
      window.localStorage.setItem(key, on ? '1' : '0');
    } catch {
      // ignore
    }
  },

  getJSON(key, fallback = null) {
    const raw = window.localStorage.getItem(key);
    return safeParse(raw, fallback);
  },

  setJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Storage.setJSON failed', e);
    }
  }
};

// Expose to window for non-module scripts
if (typeof window !== 'undefined') {
  window.StorageKeys = window.StorageKeys || StorageKeys;
  window.Storage = window.Storage || Storage;
}
