/**
 * Parent-side helper for controlling an embedded Luma PDF viewer.
 *
 *   import { createLumaBridge } from './js/embed/api.js';
 *   const luma = createLumaBridge(document.querySelector('iframe'));
 *   luma.setPage(4);
 *   luma.on('luma:pageChanged', (detail) => console.log(detail.page));
 */
export function createLumaBridge(iframe, { origin = location.origin, timeout = 8000 } = {}) {
  if (!iframe) throw new Error('createLumaBridge needs an iframe element.');
  const listeners = new Map();
  const pending = new Map();
  let ready = false;

  const onMessage = (event) => {
    if (event.source !== iframe.contentWindow) return;
    if (origin !== '*' && event.origin !== origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'luma:ready' || data.type === 'luma:loaded') ready = true;
    if (typeof data.type === 'string' && data.type.startsWith('luma:')) {
      const set = listeners.get(data.type);
      if (set) set.forEach((fn) => { try { fn(data.detail || {}); } catch (e) { console.error(e); } });
    }
    if (data.type === 'luma:response' && pending.has(data.command)) {
      const { resolve, reject, timer } = pending.get(data.command);
      clearTimeout(timer);
      pending.delete(data.command);
      if (data.ok) resolve(data.result);
      else reject(new Error(data.error || 'Command failed'));
    }
  };
  window.addEventListener('message', onMessage);

  const send = (command, payload) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(command);
      reject(new Error(`Luma PDF did not answer "${command}". Is the embed loaded?`));
    }, timeout);
    pending.set(command, { resolve, reject, timer });
    iframe.contentWindow?.postMessage({ type: 'luma', command, payload }, origin);
  });

  const api = {
    iframe,
    send,
    get ready() { return ready; },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    off(type, fn) { listeners.get(type)?.delete(fn); },
    destroy() {
      window.removeEventListener('message', onMessage);
      listeners.clear();
      pending.forEach((p) => clearTimeout(p.timer));
      pending.clear();
    },
    open(url) { return send('open', { url }); },
    setPage(n) { return send('setPage', { page: n }); },
    setZoom(z) { return send('setZoom', { zoom: z }); },
    nextPage() { return send('nextPage'); },
    previousPage() { return send('previousPage'); },
    search(text) { return send('searchText', { text }); },
    print() { return send('print'); },
    download() { return send('download'); },
    toggleSidebar() { return send('toggleSidebar'); },
    toggleFullscreen() { return send('toggleFullscreen'); },
    setTheme(theme) { return send('setTheme', { theme }); },
    getDocumentInfo() { return send('getDocumentInfo'); }
  };
  return api;
}

/** Convenience: expose window.LumaPDF for classic <script> users. */
export function installGlobalApi() {
  if (typeof window === 'undefined') return null;
  if (window.LumaPDF && window.LumaPDF.iframe) return window.LumaPDF;
  const iframe = document.querySelector('iframe[data-luma-pdf]') || document.querySelector('iframe[src*="embed.html"]');
  if (!iframe) return null;
  window.LumaPDF = createLumaBridge(iframe);
  return window.LumaPDF;
}
