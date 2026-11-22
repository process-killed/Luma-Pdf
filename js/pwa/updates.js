// Service worker registration and update flow.
import { toast } from '../ui/ui.js';
import { APP } from '../config.js';

let registration = null;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  if (location.protocol === 'file:') return null;
  try {
    registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
  } catch (e) {
    console.warn('Service worker registration failed:', e.message);
    return null;
  }

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        toast('A new version of Luma PDF is ready.', {
          type: 'info',
          title: 'Update available',
          duration: 0,
          action: { label: 'Reload to update', onClick: () => { worker.postMessage({ type: 'SKIP_WAITING' }); location.reload(); } }
        });
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (sessionStorage.getItem('luma-reloaded') === APP.version) return;
    sessionStorage.setItem('luma-reloaded', APP.version);
  });

  // Check for a new build when the tab regains focus (throttled to 10 minutes).
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheck < 600000) return;
    lastCheck = Date.now();
    registration?.update().catch(() => {});
  });

  return registration;
}

export function getRegistration() { return registration; }

export async function cacheStats() {
  if (!('caches' in window)) return null;
  const names = await caches.keys();
  let entries = 0;
  for (const name of names) {
    const cache = await caches.open(name);
    entries += (await cache.keys()).length;
  }
  return { caches: names.length, entries };
}
