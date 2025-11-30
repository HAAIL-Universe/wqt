// /scripts/api.js
// Frontend API adapter for WQT.
// v1: prefer FastAPI backend for core state, with local fallback.

import { Storage, StorageKeys } from './storage.js';

const API_BASE = 'https://wqt-backend.onrender.com';

// Tiny helper: fetch JSON from backend with basic error handling.
async function fetchJSON(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'omit',
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[WQT API] ${options.method || 'GET'} ${path} failed: ${res.status} ${res.statusText} ${text}`,
    );
  }

  return res.json();
}

export const WqtAPI = {
  // ------------------------------------------------------------------
  // Core state – mirrors loadAll/saveAll in bootstrap.js
  // Now prefers backend, with local fallback.
  // ------------------------------------------------------------------

  async loadInitialState() {
    let main;

    // 1) Try backend
    try {
      main = await fetchJSON('/api/state');
      // mirror into localStorage for offline cache
      Storage.saveMain(main);
      console.log('[WQT API] Loaded main state from backend');
    } catch (err) {
      console.warn('[WQT API] Backend load failed, falling back to localStorage:', err);
      main = Storage.loadMain();
    }

    // 2) These are still local-only for now
    const learnedUL   = Storage.loadLearnedUL();
    const customCodes = Storage.loadCustomCodes();

    return { main: main || {}, learnedUL, customCodes };
  },

  async saveState(state) {
    // `state` shape should mirror what loadInitialState returns.
    const main        = state.main || {};
    const learnedUL   = state.learnedUL || {};
    const customCodes = state.customCodes || [];

    // 1) Always write to localStorage (offline-first)
    Storage.saveMain(main);
    Storage.saveLearnedUL(learnedUL);
    Storage.saveCustomCodes(customCodes);

    // 2) Try to persist main blob to backend
    try {
      await fetchJSON('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(main),
      });
      console.log('[WQT API] Saved main state to backend');
    } catch (err) {
      console.warn('[WQT API] Failed to save main state to backend, local-only:', err);
    }
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
    // Stored as a string; normalise to number or null.
    const raw = Storage.getJSON(StorageKeys.SNAKE_LIVE_RATE, null);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  },

  async setSnakeLiveRate(rateUh) {
    if (!rateUh || !Number.isFinite(rateUh)) return;
    window.localStorage.setItem(StorageKeys.SNAKE_LIVE_RATE, String(rateUh));
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
