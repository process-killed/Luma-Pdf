// Luma PDF — application bootstrap and shared actions.
import { initSettings, store } from './state.js';
import { initTheme } from './theme.js';
import { mountShell } from './shell.js';
import { detectDevice, recommendProfile, profileConfig } from './performance/device-detection.js';
import { initInstall } from './pwa/install.js';
import { registerServiceWorker } from './pwa/updates.js';
import { saveDocument } from './storage/library.js';
import { checkFileSize, isPdfFile, readAsArrayBuffer } from './utils/files.js';
import { normalizeUrl } from './utils/urls.js';
import { toast } from './ui/ui.js';

export const device = detectDevice();

/** Boot the shared shell and services for any page. */
export async function boot({ active = '', minimal = false, serviceWorker = true } = {}) {
  await initSettings();
  const chosen = store.get('performanceProfile');
  const profileName = chosen && chosen !== 'auto' ? chosen : recommendProfile(device);
  document.documentElement.dataset.detectedProfile = profileName;
  document.documentElement.dataset.performance = profileName;
  initTheme();
  mountShell({ active, minimal });
  initInstall();
  if (serviceWorker) registerServiceWorker();
  return { profile: profileConfig(profileName) };
}

export function currentProfile() {
  const chosen = store.get('performanceProfile');
  return profileConfig(chosen && chosen !== 'auto' ? chosen : recommendProfile(device));
}

/* ---------- Opening documents ---------- */

/** Validate, persist locally and open a user-selected PDF in the viewer. */
export async function openLocalFile(file, { target = 'viewer.html', save = true } = {}) {
  if (!file) return null;
  if (!isPdfFile(file)) {
    toast('That file is not a PDF. Choose a file ending in .pdf.', { type: 'error' });
    return null;
  }
  try {
    const { warn } = checkFileSize(file);
    if (warn) toast('Large document: rendering may be slow on low-memory devices.', { type: 'warn' });
  } catch (e) {
    toast(e.message, { type: 'error', duration: 8000 });
    return null;
  }

  if (!save) {
    // Pass the bytes across pages through a short-lived session slot.
    const buffer = await readAsArrayBuffer(file);
    const key = 'pending-' + Date.now().toString(36);
    try {
      sessionStorage.setItem('luma.pending.' + key, '1');
      window.__lumaPending = { key, name: file.name, buffer };
    } catch { /* ignore */ }
    return null;
  }

  try {
    const record = await saveDocument({ name: file.name, blob: file, size: file.size });
    const url = `${target}?doc=${encodeURIComponent(record.id)}`;
    location.href = url;
    return record;
  } catch (e) {
    toast('Could not store the document locally: ' + e.message, { type: 'error' });
    return null;
  }
}

/** Open a remote PDF URL in the viewer (CORS permitting). */
export function openRemoteUrl(rawUrl, { target = 'viewer.html', page = null } = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    toast('Enter a full http:// or https:// link to a PDF file.', { type: 'error' });
    return null;
  }
  const q = new URLSearchParams({ file: url });
  if (page) q.set('page', String(page));
  location.href = `${target}?${q.toString()}`;
  return url;
}

/** Wire a dropzone: click, keyboard, drag & drop and paste. */
export function wireDropzone(zone, handler, { input } = {}) {
  if (!zone) return;
  const fileInput = input || zone.querySelector('input[type="file"]');
  const pick = () => fileInput?.click();
  zone.addEventListener('click', (e) => {
    if (e.target === fileInput) return;
    pick();
  });
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
  });
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      if (files.length) handler(files);
      fileInput.value = '';
    });
  }
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (e) => {
    e.preventDefault();
    zone.classList.add('is-dragover');
  }));
  ['dragleave', 'dragend'].forEach((type) => zone.addEventListener(type, (e) => {
    if (e.target !== zone) return;
    zone.classList.remove('is-dragover');
  }));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-dragover');
    const files = Array.from(e.dataTransfer?.files || []).filter(isPdfFile);
    if (files.length) handler(files);
    else toast('Drop a PDF file here.', { type: 'warn' });
  });
}

export function initGlobalPaste(handler) {
  document.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const file = items.find((i) => i.type === 'application/pdf');
    if (file) {
      const f = file.getAsFile();
      if (f) handler([f]);
    }
  });
}

export { toast, store };
