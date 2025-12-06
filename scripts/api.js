// /scripts/api.js
// Frontend API adapter for WQT.
// v1: prefer FastAPI backend for core state, with local fallback.

// NOTE: Storage / StorageKeys come from storage.js as globals.

// ------------------------------------------------------------------
// Backend URL resolution
// ------------------------------------------------------------------

// Default remote backend (Render)
const DEFAULT_BACKEND_URL = 'https://wqt-backend.onrender.com';

function resolveApiBase() {
    try {
        // Optional global override if you ever want to point at staging, etc.
        if (typeof window !== 'undefined' && typeof window.WQT_BACKEND_URL === 'string') {
            const trimmed = window.WQT_BACKEND_URL.trim();
            if (trimmed) {
                return trimmed.replace(/\/+$/, ''); // strip trailing slash(es)
            }
        }

        if (typeof window !== 'undefined') {
            const host = window.location.hostname;

            // Local dev example:
            // if (host === 'localhost' || host === '127.0.0.1') {
            //   return 'http://127.0.0.1:8000';
            // }
        }
    } catch (e) {
        console.warn('[WQT API] Failed to resolve API base from window, using default:', e);
    }

    // Fallback: Render backend
    return DEFAULT_BACKEND_URL.replace(/\/+$/, '');
}

const API_BASE = resolveApiBase();

// ------------------------------------------------------------------
// Device ID helper (per-browser identity, no login needed)
// ------------------------------------------------------------------

const DEVICE_ID_KEY = 'wqt_device_id';

function getDeviceId() {
    if (typeof window === 'undefined' || !window.localStorage) return null;

    try {
        let id = window.localStorage.getItem(DEVICE_ID_KEY);
        if (!id) {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                id = window.crypto.randomUUID();
            } else {
                // Fallback: reasonably unique random string
                id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
            }
            window.localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    } catch (e) {
        console.warn('[WQT API] Failed to get/create device id:', e);
        return null;
    }
}

const USER_KEY = 'wqt_username';

function getLoggedInUser() {
    try {
        // NEW: unified identity object takes priority
        const raw = localStorage.getItem('WQT_CURRENT_USER');
        if (raw) {
            try {
                const obj = JSON.parse(raw);
                if (obj && obj.userId) return obj.userId;
            } catch {}
        }

        // Compatibility fallback
        const stored = localStorage.getItem(USER_KEY);
        if (stored && stored.trim()) return stored.trim();

        const opId = localStorage.getItem('wqt_operator_id');
        if (opId && opId.trim()) return opId.trim();

        return null;
    } catch (e) {
        console.warn('[WQT API] getLoggedInUser failed:', e);
        return null;
    }
}

/**
 * Returns { userId, displayName, role } if logged in, otherwise null.
 * userId = PIN (ID), displayName = human-friendly name for UI.
 */
function getLoggedInUserIdentity() {
    try {
        const raw = localStorage.getItem('WQT_CURRENT_USER');
        if (raw) {
            try {
                const obj = JSON.parse(raw);
                if (obj && obj.userId) {
                    return {
                        userId: obj.userId,
                        displayName: obj.displayName || obj.userId,
                        role: obj.role || null,
                    };
                }
            } catch {}
        }

        const id = getLoggedInUser();
        if (!id) return null;

        return { userId: id, displayName: id, role: null };
    } catch (e) {
        console.warn('[WQT API] getLoggedInUserIdentity failed:', e);
        return null;
    }
}

// Tiny helper: fetch JSON from backend with basic error handling.
async function fetchJSON(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
        credentials: 'omit',
        ...options,
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
            `[WQT API] ${options.method || 'GET'} ${url} failed: ${res.status} ${res.statusText} ${text}`,
        );
    }

    return res.json();
}

const WqtAPI = {

            // Overlay session login
    async loginOverlaySession(pin, requestedRole) {
        const deviceId =
            localStorage.getItem('wqt_device_id') ||
            localStorage.getItem('device_id') ||
            null;

        const resp = await fetch('/auth/login_pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pin_code: String(pin).trim(),
                device_id: deviceId,
                mode: "overlay",
                requested_role: requestedRole
            })
        });

        if (!resp.ok) {
            const msg = await resp.json().catch(() => ({detail:"Error"}));
            throw new Error(msg.detail || "Access denied");
        }

        const data = await resp.json();

        const overlay = {
            user_id: data.user_id,
            display_name: data.display_name,
            role: data.role,       // "operative" or "supervisor"
            mode: "overlay"
        };

        localStorage.setItem('wqt_overlay_session', JSON.stringify(overlay));
        return overlay;
    },

            loadOverlaySession() {
                    try {
                        const raw = localStorage.getItem('wqt_overlay_session');
                        return raw ? JSON.parse(raw) : null;
                    } catch {
                        return null;
                    }
            },

            clearOverlaySession() {
                    try { localStorage.removeItem('wqt_overlay_session'); } catch {}
            },
    // ------------------------------------------------------------------
    // Core state – mirrors loadAll/saveAll in bootstrap.js
    // Now prefers backend, with local fallback.
    // ------------------------------------------------------------------

    async loadInitialState() {
        // 0) Grab whatever we already have locally (per-user namespaced)
        const localMain = Storage.loadMain ? Storage.loadMain() : null;
        let remoteMain = null;

        function looksPopulated(state) {
            if (!state || typeof state !== 'object') return false;
            if (Array.isArray(state.history) && state.history.length > 0) return true;
            if (Array.isArray(state.picks) && state.picks.length > 0) return true;
            if (state.startTime && typeof state.startTime === 'string') return true;
            return false;
        }

        // 1) Try backend
        try {
            const deviceId = getDeviceId();
            const userId = getLoggedInUser();

            let qs = deviceId ? `?device-id=${encodeURIComponent(deviceId)}` : '';
            if (userId) qs += `${qs ? '&' : '?'}user-id=${encodeURIComponent(userId)}`;

            remoteMain = await fetchJSON(`/api/state${qs}`);
        } catch (err) {
            console.warn('[WQT API] Backend load failed, continuing local-only:', err);
        }

        // 2) Decide which one to trust
        let main;

        if (looksPopulated(remoteMain)) {
            main = remoteMain;
            Storage.saveMain(main);
            console.log('[WQT API] Loaded main state from backend (User/Device)');
        } else if (looksPopulated(localMain)) {
            main = localMain;
            console.log('[WQT API] Using local main state (backend empty or unavailable)');
        } else {
            main = remoteMain || localMain || {};
            Storage.saveMain(main);
            console.log('[WQT API] Initialised blank main state');
        }

        const learnedUL = Storage.loadLearnedUL();
        const customCodes = Storage.loadCustomCodes();

        return { main: main || {}, learnedUL, customCodes };
    },

    async saveState(state) {
        // 1) Always write to localStorage (offline-first)
        const main = state.main || {};
        const learnedUL = state.learnedUL || {};
        const customCodes = state.customCodes || [];

        Storage.saveMain(main);
        Storage.saveLearnedUL(learnedUL);
        Storage.saveCustomCodes(customCodes);

        // 2) Try to persist to backend
        try {
            const deviceId = getDeviceId();

            // Identity: PIN as ID, displayName / role for humans
            const identity = getLoggedInUserIdentity();
            const userId = identity ? identity.userId : null;
            const displayName = identity ? identity.displayName : null;
            const role = identity ? identity.role : null;

            const opId = (typeof window !== 'undefined' && window.localStorage)
                ? window.localStorage.getItem('wqt_operator_id')
                : null;
            const breakDraftRaw = (typeof window !== 'undefined' && window.localStorage)
                ? window.localStorage.getItem('breakDraft')
                : null;

            // --- DEEP COPY FIX (Backend expects a clean object) ---
            const payload = JSON.parse(JSON.stringify(main));

            // Ensure 'current' exists in our copy
            if (!payload.current) { payload.current = {}; }

            // Inject Operator ID (PIN)
            if (userId) {
                payload.current.operator_id = userId; // PIN as ID
            } else if (opId) {
                // Legacy path: only have a free-text operator ID
                payload.current.operator_id = opId;
            }

            // Inject human-friendly name + role without overwriting order name
            if (displayName) {
                payload.current.operator_name = displayName;
            }
            if (role) {
                payload.current.operator_role = role;
            }

            // Optionally include breakDraft info with state if needed later
            if (breakDraftRaw && !payload.current.breakDraft) {
                try {
                    payload.current.breakDraft = JSON.parse(breakDraftRaw);
                } catch {
                    // ignore parse errors
                }
            }

            // Build query string for POST just like GET
            let qs = deviceId ? `?device-id=${encodeURIComponent(deviceId)}` : '';
            if (userId) qs += `${qs ? '&' : '?'}user-id=${encodeURIComponent(userId)}`;

            await fetchJSON(`/api/state${qs}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            console.log('[WQT API] Saved main state to backend (User/Device)');
        } catch (err) {
            console.warn('[WQT API] Failed to save main state to backend, local-only:', err);
        }
    },

    // ------------------------------------------------------------------
    // NEW: Orders – record closed orders into backend summary table
    // ------------------------------------------------------------------

    /**
     * Record a closed order snapshot into the backend `/api/orders/record` endpoint.
     * `order` should be the archived object you already push into `picks`.
     */
    async recordClosedOrder(order) {
        try {
            const deviceId = getDeviceId();
            const identity = getLoggedInUserIdentity() || {};

            const fallbackOpId = (typeof window !== 'undefined' && window.localStorage)
                ? window.localStorage.getItem('wqt_operator_id')
                : null;

            const operator_id =
                identity.userId ||
                fallbackOpId ||
                'unknown';

            const payload = {
                operator_id,
                operator_name: identity.displayName || null,
                device_id: deviceId || null,
                order: order || {},
                notes: null
            };

            await fetchJSON('/api/orders/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            console.log('[WQT API] recordClosedOrder → sent to backend');
        } catch (e) {
            // Non-fatal: do not block UI just because backend logging failed
            console.warn('[WQT API] recordClosedOrder failed (non-fatal):', e);
        }
    },

    async login(username, pin) {
        const res = await fetchJSON('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, pin })
        });

        if (res.success) {
            // Username/PIN stays as the internal ID
            localStorage.setItem(USER_KEY, res.username);

            const displayName = res.display_name || res.username;
            const role = res.role || null;

            // What the UI shows in the top-left etc.
            localStorage.setItem('wqt_operator_id', displayName);

            // Unified identity blob used by getLoggedInUserIdentity()
            localStorage.setItem(
                'WQT_CURRENT_USER',
                JSON.stringify({
                    userId: res.username,
                    displayName,
                    role,
                })
            );

            // 🔒 CRITICAL: hard cutover to this user's state.
            // On reload, boot code will call WqtAPI.loadInitialState()
            // and hydrate history/picks from THIS user, not the previous one.
            window.location.reload();
        }

        return res;
    },



    async register(username, pin) {
        const res = await fetchJSON('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, pin })
        });

        if (res.success) {
            // Username/PIN stays as the internal ID
            localStorage.setItem(USER_KEY, res.username);

            const displayName = res.display_name || res.username;
            const role = res.role || null;

            // What the UI shows in the top-left etc.
            localStorage.setItem('wqt_operator_id', displayName);

            // Unified identity blob used by getLoggedInUserIdentity()
            localStorage.setItem(
                'WQT_CURRENT_USER',
                JSON.stringify({
                    userId: res.username,
                    displayName,
                    role,
                })
            );

            // 🔒 Same as login: after first registration, reload into a clean state
            window.location.reload();
        }

        return res;
    },

    async logout() {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem('wqt_operator_id');
        localStorage.removeItem('WQT_CURRENT_USER');
        window.location.reload();
    },

    // ------------------------------------------------------------------
    // Shift/session-side data (outside main blob)
    // These stay in localStorage for now (no schema yet).
    // ------------------------------------------------------------------

    async getShiftActive() {
        return Storage.getFlag(StorageKeys.SHIFT_ACTIVE);
    },

    async setShiftActive(active) {
        Storage.setFlag(StorageKeys.SHIFT_ACTIVE, !!active);
    },

    async getCurrentOrder() {
        return Storage.getJSON(StorageKeys.CURRENT_ORDER, null);
    },

    async setCurrentOrder(order) {
        Storage.setJSON(StorageKeys.CURRENT_ORDER, order || null);
    },

    async clearCurrentOrder() {
        Storage.setJSON(StorageKeys.CURRENT_ORDER, null);
    },

    async getShiftDelays() {
        return Storage.getJSON(StorageKeys.SHIFT_DELAYS, []) || [];
    },

    async appendShiftDelay(entry) {
        const arr = (await this.getShiftDelays()).slice();
        arr.push(entry);
        Storage.setJSON(StorageKeys.SHIFT_DELAYS, arr);
        return arr;
    },

    async getShiftNotes() {
        return Storage.getJSON(StorageKeys.SHIFT_NOTES, []) || [];
    },

    async appendShiftNote(entry) {
        const arr = (await this.getShiftNotes()).slice();
        arr.push(entry);
        Storage.setJSON(StorageKeys.SHIFT_NOTES, arr);
        return arr;
    },

    async getBreakDraft() {
        return Storage.getJSON(StorageKeys.BREAK_DRAFT, null);
    },

    async setBreakDraft(draft) {
        Storage.setJSON(StorageKeys.BREAK_DRAFT, draft || null);
    },

    async clearBreakDraft() {
        Storage.setJSON(StorageKeys.BREAK_DRAFT, null);
    },

    // Shared pick dock state
    async getSharedDockOpen() {
        return Storage.getFlag(StorageKeys.SHARED_DOCK_OPEN);
    },

    async setSharedDockOpen(open) {
        Storage.setFlag(StorageKeys.SHARED_DOCK_OPEN, !!open);
    },

    async getSharedBlock() {
        return Storage.getJSON(StorageKeys.SHARED_BLOCK, null);
    },

    async setSharedBlock(block) {
        Storage.setJSON(StorageKeys.SHARED_BLOCK, block || null);
    },

    async getSharedMySum() {
        return Storage.getJSON(StorageKeys.SHARED_MY_SUM, null);
    },

    async setSharedMySum(summary) {
        Storage.setJSON(StorageKeys.SHARED_MY_SUM, summary || null);
    },

    // Snake delay + live rate
    async getSnakeDelayDraft() {
        return Storage.getJSON(StorageKeys.SNAKE_DELAY_DRAFT, null);
    },

    async setSnakeDelayDraft(draft) {
        Storage.setJSON(StorageKeys.SNAKE_DELAY_DRAFT, draft || null);
    },

    async clearSnakeDelayDraft() {
        Storage.setJSON(StorageKeys.SNAKE_DELAY_DRAFT, null);
    },

    async getSnakeDelayCompleted() {
        return Storage.getJSON(StorageKeys.SNAKE_DELAY_DONE, null);
    },

    async setSnakeDelayCompleted(done) {
        Storage.setJSON(StorageKeys.SNAKE_DELAY_DONE, done || null);
    },

    async clearSnakeDelayCompleted() {
        Storage.setJSON(StorageKeys.SNAKE_DELAY_DONE, null);
    },

    async getSnakeLiveRate() {
        // Stored as a plain string; normalise to number or null.
        try {
            const raw = window.localStorage.getItem(StorageKeys.SNAKE_LIVE_RATE);
            if (!raw) return null;
            const n = Number(raw);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch {
            return null;
        }
    },

    async setSnakeLiveRate(rateUh) {
        if (!rateUh || !Number.isFinite(rateUh)) return;
        try {
            window.localStorage.setItem(StorageKeys.SNAKE_LIVE_RATE, String(rateUh));
        } catch (e) {
            console.error('WqtAPI.setSnakeLiveRate failed', e);
        }
    },

    // History UI: collapsed week card flag
    async getWeekCardCollapsed() {
        return Storage.getFlag(StorageKeys.WEEK_CARD_COLLAPSED);
    },

    async setWeekCardCollapsed(collapsed) {
        Storage.setFlag(StorageKeys.WEEK_CARD_COLLAPSED, !!collapsed);
    },

    // Legacy pro flag (outside main blob, used as a gate)
    async getProUnlockedFlag() {
        return Storage.getFlag(StorageKeys.PRO_UNLOCKED_FLAG);
    },

    async setProUnlockedFlag(on) {
        Storage.setFlag(StorageKeys.PRO_UNLOCKED_FLAG, !!on);
    },

    // ------------------------------------------------------------------
    // SaaS-ready aggregations / exports (can become real endpoints)
    // ------------------------------------------------------------------

    async fetchShiftSummary() {
        const { main } = await this.loadInitialState();
        return {
            startTime: main.startTime || '',
            lastClose: main.lastClose || '',
            picks: main.picks || [],
            history: main.history || []
        };
    },

    async exportJsonAll() {
        const { main } = await this.loadInitialState();
        return main;
    },

    async importJsonAll(payload) {
        const { main, learnedUL, customCodes } = await this.loadInitialState();
        const merged = {
            ...main,
            ...(payload || {})
        };
        await this.saveState({ main: merged, learnedUL, customCodes });
        return merged;
    }
};

// Expose to window for non-module scripts
if (typeof window !== 'undefined') {
    window.WqtAPI = window.WqtAPI || WqtAPI;
    window.WqtAPI.getLoggedInUser = getLoggedInUser;           // Expose helper for use in bootstrap.js
    window.WqtAPI.getDeviceId = getDeviceId;                   // Expose helper for use in bootstrap.js
    window.WqtAPI.getLoggedInUserIdentity = getLoggedInUserIdentity;
}
