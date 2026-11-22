// Settings page — appearance, defaults, performance, storage.
import { boot, device } from '../app.js';
import { store } from '../state.js';
import { applyAppearance } from '../theme.js';
import { toast, confirmDialog, initMenus } from '../ui/ui.js';
import { formatBytes, downloadBlob } from '../utils/files.js';
import { storageEstimate, clearLibrary, libraryAvailable } from '../storage/library.js';
import { profileConfig, recommendProfile } from '../performance/device-detection.js';
import { browserLabel, env, supports } from '../utils/browser.js';
import { APP } from '../config.js';
import { getRegistration, cacheStats } from '../pwa/updates.js';

const bindings = [
  ['set-theme', 'theme', 'value'],
  ['set-readbg', 'readBg', 'value'],
  ['set-filter', 'pageFilter', 'value'],
  ['set-contrast', 'contrast', 'checkbox'],
  ['set-motion', 'motion', 'checkbox'],
  ['set-mode', 'mode', 'value'],
  ['set-zoom', 'zoom', 'value'],
  ['set-gap', 'gap', 'number'],
  ['set-restore', 'restorePosition', 'checkbox'],
  ['set-shortcuts', 'shortcutsEnabled', 'checkbox'],
  ['set-profile', 'performanceProfile', 'value']
];

async function main() {
  await boot({ active: '' });
  initMenus();

  bindings.forEach(([id, key, kind]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (kind === 'checkbox') {
      el.checked = key === 'contrast' ? store.get('contrast') === 'high' : key === 'motion' ? store.get('motion') === 'reduced' : !!store.get(key);
      el.addEventListener('change', () => {
        if (key === 'contrast') store.set('contrast', el.checked ? 'high' : 'normal');
        else if (key === 'motion') store.set('motion', el.checked ? 'reduced' : 'full');
        else store.set(key, el.checked);
        applyAppearance();
      });
    } else if (kind === 'number') {
      el.value = String(store.get(key) ?? 14);
      el.addEventListener('change', () => {
        store.set(key, Math.max(0, Math.min(48, Number(el.value) || 0)));
        toast('Page gap updated — reopen a document to see it', { duration: 2200 });
      });
    } else {
      el.value = String(store.get(key) ?? '');
      el.addEventListener('change', () => {
        store.set(key, el.value);
        applyAppearance();
        if (key === 'performanceProfile') paintProfileHint();
      });
    }
  });

  paintDevice();
  paintProfileHint();
  paintStorage();
  paintAbout();

  document.getElementById('export-settings').addEventListener('click', exportSettings);
  document.getElementById('import-settings').addEventListener('click', () => document.getElementById('settings-import').click());
  document.getElementById('settings-import').addEventListener('change', importSettings);
  document.getElementById('clear-library').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Clear saved documents?',
      message: 'Every PDF, annotation and reading position stored in this browser will be deleted. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true
    });
    if (!ok) return;
    await clearLibrary();
    toast('Local documents cleared', { type: 'success' });
    paintStorage();
  });
  document.getElementById('reset-all').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset all settings?',
      message: 'Preferences return to their defaults and saved documents are removed from this browser.',
      confirmLabel: 'Reset everything',
      danger: true
    });
    if (!ok) return;
    await store.reset();
    await clearLibrary();
    localStorage.removeItem('luma.settings.v1');
    toast('Reset complete — reloading', { type: 'success' });
    setTimeout(() => location.reload(), 900);
  });
}

function paintDevice() {
  const host = document.getElementById('device-info');
  const mem = device.memoryGB ? `${device.memoryGB} GB` : 'not reported';
  const cores = device.cores || 'not reported';
  const conn = device.connection ? `${device.connection.type || 'unknown'}${device.connection.saveData ? ' · data saver' : ''}` : 'not reported';
  host.innerHTML = `
    <div>${browserLabel()} · ${env.isIOS ? 'iOS' : env.isAndroid ? 'Android' : 'desktop'}${env.standalone ? ' · installed' : ''}</div>
    <div>Memory: ${mem} · Cores: ${cores}</div>
    <div>Screen: ${device.screen} · Viewport: ${device.viewport} · DPR ${device.dpr}</div>
    <div>Connection: ${conn}</div>
    <div>Touch: ${device.touch ? 'yes' : 'no'} · IndexedDB: ${supports.indexedDB ? 'yes' : 'no'} · Service worker: ${supports.serviceWorker ? 'yes' : 'no'}</div>
    <div>File System Access: ${supports.fileSystemAccess ? 'available' : 'not available'}</div>`;
}

function paintProfileHint() {
  const chosen = store.get('performanceProfile');
  const effective = profileConfig(chosen === 'auto' ? recommendProfile(device) : chosen);
  document.getElementById('profile-hint').textContent =
    `Active profile: ${effective.label} · ${Math.round((effective.maxCanvasPixels || 0) / 1_000_000 * 10) / 10} MP canvas budget · ${effective.maxConcurrentRenders} concurrent render${effective.maxConcurrentRenders === 1 ? '' : 's'}`;
}

async function paintStorage() {
  const est = await storageEstimate();
  document.getElementById('store-used').textContent = est.quota
    ? `${formatBytes(est.usage)} of ${formatBytes(est.quota)}`
    : formatBytes(est.usage || 0);
  document.getElementById('store-bar').style.width = `${Math.min(100, est.percent || 0)}%`;
}

async function paintAbout() {
  document.querySelectorAll('[data-build-stamp]').forEach((n) => { n.textContent = `v${APP.version} · ${APP.build}`; });
  const engine = document.getElementById('engine-version');
  const lib = window.pdfjsLib;
  engine.textContent = lib?.version ? `PDF.js ${lib.version}` : 'not loaded on this page';
  const state = document.getElementById('install-state');
  if (env.standalone) state.textContent = 'Installed (standalone)';
  else if (supports.pwaInstall) state.textContent = 'Available from the browser menu';
  else state.textContent = 'Not available in this browser';
  try {
    const reg = getRegistration();
    if (reg) state.title = `Service worker: ${reg.active ? 'active' : 'installing'}`;
  } catch { /* ignore */ }
}

function exportSettings() {
  const data = { app: 'Luma PDF', version: APP.version, exportedAt: new Date().toISOString(), settings: store.all() };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'luma-pdf-settings.json');
  toast('Settings exported', { type: 'success' });
}

async function importSettings() {
  const input = document.getElementById('settings-import');
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed.settings || parsed;
    if (!incoming || typeof incoming !== 'object') throw new Error('That file does not contain Luma PDF settings.');
    const allowed = new Set(Object.keys(store.all()));
    let applied = 0;
    for (const [k, v] of Object.entries(incoming)) {
      if (allowed.has(k)) { store.set(k, v); applied++; }
    }
    applyAppearance();
    paintProfileHint();
    toast(`${applied} settings imported`, { type: 'success' });
  } catch (e) {
    toast('Import failed: ' + e.message, { type: 'error' });
  }
}

main().catch((e) => {
  console.error(e);
  toast('Settings failed to load: ' + e.message, { type: 'error' });
});
