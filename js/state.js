// Application settings store with persistence (IndexedDB + localStorage mirror).
import { VIEWER_DEFAULTS } from './config.js';
import { dbGet, dbPut } from './storage/database.js';
import { debounce } from './utils/dom.js';

const KEY = 'settings-main';
const LS_KEY = 'luma.settings.v1';

const defaults = {
  ...VIEWER_DEFAULTS,
  theme: 'auto',
  performanceProfile: 'auto',
  contrast: 'normal',
  motion: 'auto',
  onboardingDone: false,
  shortcutsEnabled: true,
  showBuildStamp: true,
  libraryEnabled: true,
  ocrLanguage: 'eng',
  lastDoc: null
};

class SettingsStore {
  constructor() {
    this.state = { ...defaults };
    this.listeners = new Set();
    this.persist = debounce(() => this.save(), 250);
  }
  get(key) { return this.state[key]; }
  all() { return { ...this.state }; }
  set(key, value) {
    if (this.state[key] === value) return;
    this.state[key] = value;
    this.emit(key, value);
    this.persist();
  }
  patch(obj) {
    let changed = false;
    for (const [k, v] of Object.entries(obj)) {
      if (this.state[k] !== v) { this.state[k] = v; changed = true; this.emit(k, v); }
    }
    if (changed) this.persist();
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(key, value) { this.listeners.forEach((fn) => { try { fn(key, value, this.state); } catch (e) { console.warn(e); } }); }

  async load() {
    let stored = null;
    try {
      const rec = await dbGet('settings', KEY);
      if (rec && rec.data) stored = rec.data;
    } catch { /* ignore */ }
    if (!stored) {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) stored = JSON.parse(raw);
      } catch { /* ignore */ }
    }
    if (stored && typeof stored === 'object') {
      this.state = { ...defaults, ...stored };
      this.listeners.forEach((fn) => fn('*', null, this.state));
    }
    return this.state;
  }

  async save() {
    const data = { ...this.state };
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* quota */ }
    try { await dbPut('settings', { id: KEY, data, updatedAt: Date.now() }); } catch { /* idb unavailable */ }
  }

  async reset() {
    this.state = { ...defaults };
    this.listeners.forEach((fn) => fn('*', null, this.state));
    await this.save();
  }
}

export const store = new SettingsStore();
export const settings = store.state;

export function initSettings() { return store.load(); }
