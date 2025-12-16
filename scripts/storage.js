// ====== Bay Outbox (Offline-first warehouse map updates) ======
const BAY_OUTBOX_KEY = 'wqt_bay_outbox_v1';

function loadBayOutbox() {
  try {
    const raw = window.localStorage.getItem(BAY_OUTBOX_KEY);
    const parsed = safeParse(raw, null);
    if (parsed && parsed.version === 1 && parsed.pending_by_code) return parsed;
  } catch (_) {}
  return { version: 1, updated_at: null, pending_by_code: {} };
}

function saveBayOutbox(outbox) {
  try {
    outbox.version = 1;
    outbox.updated_at = new Date().toISOString();
    window.localStorage.setItem(BAY_OUTBOX_KEY, JSON.stringify(outbox));
  } catch (_) {}
}

function normalizeLocationCode(code) {
  if (!code || typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

function generateEventId() {
  // Simple UUID-ish: yyyymmddhhmmss + random
  const now = new Date();
  return (
    now.getFullYear().toString() +
    (now.getMonth()+1).toString().padStart(2,'0') +
    now.getDate().toString().padStart(2,'0') +
    now.getHours().toString().padStart(2,'0') +
    now.getMinutes().toString().padStart(2,'0') +
    now.getSeconds().toString().padStart(2,'0') +
    '-' + Math.random().toString(36).slice(2,8)
  );
}

function queueBayUpdate({ code, is_empty, pallet_type }) {
  const outbox = loadBayOutbox();
  const normCode = normalizeLocationCode(code);
  if (!normCode) return { count: Object.keys(outbox.pending_by_code).length, queued_entry: null };
  const entry = {
    code: normCode,
    is_empty: !!is_empty,
    pallet_type: pallet_type === 'EURO' ? 'EURO' : 'UK',
    ts: new Date().toISOString(),
    event_id: generateEventId()
  };
  outbox.pending_by_code[normCode] = entry;
  saveBayOutbox(outbox);
  return { count: Object.keys(outbox.pending_by_code).length, queued_entry: entry };
}

function getBayOutboxCount() {
  const outbox = loadBayOutbox();
  return Object.keys(outbox.pending_by_code).length;
}

function listBayOutboxUpdates() {
  const outbox = loadBayOutbox();
  return Object.values(outbox.pending_by_code);
}

function clearBayOutbox() {
  window.localStorage.removeItem(BAY_OUTBOX_KEY);
}

// Expose to window for use in core-state-ui.js
if (typeof window !== 'undefined') {
  window.WqtStorage = window.WqtStorage || {};
  window.WqtStorage.loadBayOutbox = loadBayOutbox;
  window.WqtStorage.saveBayOutbox = saveBayOutbox;
  window.WqtStorage.normalizeLocationCode = normalizeLocationCode;
  window.WqtStorage.queueBayUpdate = queueBayUpdate;
  window.WqtStorage.getBayOutboxCount = getBayOutboxCount;
  window.WqtStorage.listBayOutboxUpdates = listBayOutboxUpdates;
  window.WqtStorage.clearBayOutbox = clearBayOutbox;
}
// /scripts/storage.js
// Centralised localStorage wrapper for WQT.
// This mirrors the *existing* QC-Tracker schema so we can
// gradually route all persistence through here and later
// swap to a real backend without changing the rest of the app.

// Core keys – must match bootstrap.js
const STORAGE_KEY_MAIN  = 'wqt_v2722_data';   // == KEY
const STORAGE_KEY_LEARN = 'wqt_learn_ul';     // == KEY_LEARN
const STORAGE_KEY_CODES = 'wqt_codes';        // == KEY_CODES

// Identity key shared with login.js
const CURRENT_USER_KEY  = 'WQT_CURRENT_USER';

// Side-channel keys used directly in bootstrap.js
// (delays, notes, shared pick, etc.)
const StorageKeys = {
  SHIFT_ACTIVE:        'shiftActive',        // "1"/"0" flag
  CURRENT_ORDER:       'currentOrder',       // JSON blob for active order
  SHIFT_DELAYS:        'shiftDelays',        // JSON array [{type:'D',...}]
  SHIFT_NOTES:         'shiftNotes',         // JSON array [{t,note,op?}]
  BREAK_DRAFT:         'breakDraft',         // JSON draft for open break
  SHARED_BLOCK:        'sharedBlock',        // JSON shared order meta
  SHARED_DOCK_OPEN:    'sharedDockOpen',     // "1"/"0" dock open flag
  SHARED_MY_SUM:       'sharedMySum',        // JSON summary for my units
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

// ---- Identity helpers for per-user namespaces ----

// Track last known user to detect user switches
let _lastKnownUserId = null;

function getCurrentUserId() {
  try {
    const raw = window.localStorage.getItem(CURRENT_USER_KEY);
    if (raw) {
      const u = JSON.parse(raw);
      if (u && (u.userId || u.username || u.id)) {
        const currentUserId = String(u.userId || u.username || u.id);
        
        // Detect user switch (different user on same device)
        if (_lastKnownUserId && _lastKnownUserId !== currentUserId) {
          console.warn(`[Storage] User switch detected: ${_lastKnownUserId} → ${currentUserId}`);
          console.log('[Storage] User-specific data will be isolated by user ID');
        }
        _lastKnownUserId = currentUserId;
        
        return currentUserId;
      }
    }
  } catch (_) {
    // ignore JSON errors
  }

  // Legacy compatibility: fall back to older keys if present
  try {
    const legacy =
      window.localStorage.getItem('wqt_operator_id') ||
      window.localStorage.getItem('wqt_username');
    if (legacy) {
      const legacyId = String(legacy);
      if (_lastKnownUserId && _lastKnownUserId !== legacyId) {
        console.warn(`[Storage] User switch detected (legacy): ${_lastKnownUserId} → ${legacyId}`);
      }
      _lastKnownUserId = legacyId;
      return legacyId;
    }
  } catch (_) {
    // ignore
  }

  return null;
}

function buildNamespacedKey(baseKey) {
  const userId = getCurrentUserId();
  if (!userId) {
    // No user identified on this device – preserve legacy behaviour
    return baseKey;
  }
  return baseKey + '__u_' + userId;
}

const Storage = {
  // ---- Core state blob (picks, history, current, etc.) ----
  // This mirrors loadAll/saveAll in bootstrap.js.
  loadMain() {
    const userId = getCurrentUserId();
    const mainKey = buildNamespacedKey(STORAGE_KEY_MAIN);
    let raw = null;
    let parsed = null;
    let migratedFromLegacy = false;

    try {
      raw = window.localStorage.getItem(mainKey);
      if (!raw && mainKey !== STORAGE_KEY_MAIN) {
        // No user-specific blob yet – check if we should migrate from legacy
        const legacyRaw = window.localStorage.getItem(STORAGE_KEY_MAIN);
        if (legacyRaw) {
          // Only migrate if this is the FIRST time this user is logging in
          // Do NOT reuse another user's legacy data
          console.warn(`[Storage] Found legacy data for user ${userId} - will migrate only if this is first login`);
          raw = legacyRaw;
          migratedFromLegacy = true;
        }
      }
      parsed = safeParse(raw, null);
      
      if (parsed && userId) {
        console.log(`[Storage] Loaded data for user ${userId}: ${parsed.history?.length || 0} history records`);
      }
    } catch (e) {
      console.error('Storage.loadMain failed', e);
      parsed = null;
    }

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
        shiftBreaks: [],
        operativeLog: [],
        operativeActive: null
      };
    }

    // If we migrated from the legacy global key, re-save under the user key
    if (migratedFromLegacy && mainKey !== STORAGE_KEY_MAIN) {
      try {
        window.localStorage.setItem(mainKey, JSON.stringify(parsed));
      } catch (e) {
        console.warn('Failed to migrate legacy main storage to user key', e);
      }
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
        shiftBreaks: s.shiftBreaks || [],
        operativeLog: s.operativeLog || [],
        operativeActive: s.operativeActive || null
      };

      const mainKey = buildNamespacedKey(STORAGE_KEY_MAIN);
      window.localStorage.setItem(mainKey, JSON.stringify(payload));
    } catch (e) {
      console.error('Storage.saveMain failed', e);
    }
  },

  // ---- Learned UL ----
  loadLearnedUL() {
    try {
      const learnKey = buildNamespacedKey(STORAGE_KEY_LEARN);
      const raw = window.localStorage.getItem(learnKey);
      const parsed = safeParse(raw, null);
      if (parsed) return parsed;

      // Fallback to legacy global key if no per-user data
      if (learnKey !== STORAGE_KEY_LEARN) {
        const legacyRaw = window.localStorage.getItem(STORAGE_KEY_LEARN);
        return safeParse(legacyRaw, {}) || {};
      }
    } catch (e) {
      console.error('Storage.loadLearnedUL failed', e);
    }
    return {};
  },

  saveLearnedUL(learned) {
    try {
      const learnKey = buildNamespacedKey(STORAGE_KEY_LEARN);
      window.localStorage.setItem(
        learnKey,
        JSON.stringify(learned || {})
      );
    } catch (e) {
      console.error('Storage.saveLearnedUL failed', e);
    }
  },

  // ---- Custom store codes ----
  loadCustomCodes() {
    try {
      const codesKey = buildNamespacedKey(STORAGE_KEY_CODES);
      const raw = window.localStorage.getItem(codesKey);
      const parsed = safeParse(raw, null);
      if (parsed) return parsed;

      // Fallback to legacy global key if no per-user data
      if (codesKey !== STORAGE_KEY_CODES) {
        const legacyRaw = window.localStorage.getItem(STORAGE_KEY_CODES);
        return safeParse(legacyRaw, []) || [];
      }
    } catch (e) {
      console.error('Storage.loadCustomCodes failed', e);
    }
    return [];
  },

  saveCustomCodes(codes) {
    try {
      const codesKey = buildNamespacedKey(STORAGE_KEY_CODES);
      window.localStorage.setItem(
        codesKey,
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
  },

  // ---- Pending Operations Queue (Offline Recovery) ----
  // Used to store operations that need to sync to backend when online
  
  loadPendingOps() {
    try {
      const key = buildNamespacedKey('wqt_pending_ops');
      const raw = window.localStorage.getItem(key);
      const parsed = safeParse(raw, null);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      console.error('Storage.loadPendingOps failed', e);
    }
    return [];
  },

  savePendingOps(list) {
    try {
      const key = buildNamespacedKey('wqt_pending_ops');
      window.localStorage.setItem(key, JSON.stringify(list || []));
    } catch (e) {
      console.error('Storage.savePendingOps failed', e);
    }
  },

  enqueuePendingOp(op) {
    try {
      const list = this.loadPendingOps();
      list.push(op);
      this.savePendingOps(list);
      console.log('[Storage] Enqueued pending op:', op.type, op.id);
    } catch (e) {
      console.error('Storage.enqueuePendingOp failed', e);
    }
  },

  removePendingOp(id) {
    try {
      const list = this.loadPendingOps();
      const filtered = list.filter(op => op.id !== id);
      this.savePendingOps(filtered);
      console.log('[Storage] Removed pending op:', id);
    } catch (e) {
      console.error('Storage.removePendingOp failed', e);
    }
  }
};

// Expose to window for non-module scripts
if (typeof window !== 'undefined') {
  window.StorageKeys = window.StorageKeys || StorageKeys;
  window.Storage = window.Storage || Storage;
}
