/* Luma PDF service worker — offline application shell.
   Documents you save are stored by the page in IndexedDB, not here. */
const VERSION = 'luma-pdf-v1.5.0';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

// Cached during install: the app shell only, so the first load is fast.
// Cached during install: pages and styles only (~150 KB), so a first visit is fast.
// Cached during install: pages and styles only (~150 KB), so a first visit is fast.
// Cached during install: pages and styles only (~150 KB), so a first visit is fast.
// Cached during install: pages and styles only (~150 KB), so a first visit is fast.
// Cached during install: pages and styles only (~150 KB), so a first visit is fast.
const CORE = [
  './about.html',
  './css/animations.css',
  './css/annotations.css',
  './css/editor.css',
  './css/embed.css',
  './css/homepage.css',
  './css/layout.css',
  './css/main.css',
  './css/reset.css',
  './css/responsive.css',
  './css/sidebar.css',
  './css/themes.css',
  './css/tokens.css',
  './css/toolbar.css',
  './css/tools.css',
  './css/viewer.css',
  './docs.html',
  './editor.html',
  './embed-generator.html',
  './embed.html',
  './favicon.svg',
  './index.html',
  './js/app.js',
  './js/config.js',
  './js/shell.js',
  './js/state.js',
  './js/theme.js',
  './library.html',
  './manifest.json',
  './offline.html',
  './settings.html',
  './tools.html',
  './viewer.html',
];

// Everything else is warmed quietly after install.
const EXTRA = [
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/logo-maskable.svg',
  './assets/icons/logo.svg',
  './deployment/vercel.json',
  './js/editor/document-editor.js',
  './js/editor/export.js',
  './js/editor/image-editor.js',
  './js/editor/page-editor.js',
  './js/editor/text-editor.js',
  './js/embed/api.js',
  './js/embed/config.js',
  './js/embed/messaging.js',
  './js/pages/about.js',
  './js/pages/docs.js',
  './js/pages/editor.js',
  './js/pages/embed-generator.js',
  './js/pages/embed.js',
  './js/pages/home.js',
  './js/pages/library.js',
  './js/pages/settings.js',
  './js/pages/tools.js',
  './js/pages/viewer.js',
  './js/performance/adaptive-rendering.js',
  './js/performance/device-detection.js',
  './js/performance/memory-manager.js',
  './js/pwa/install.js',
  './js/pwa/updates.js',
  './js/storage/cache.js',
  './js/storage/database.js',
  './js/storage/history.js',
  './js/storage/library.js',
  './js/tools/catalog.js',
  './js/tools/compress.js',
  './js/tools/convert.js',
  './js/tools/impose.js',
  './js/tools/markdown.js',
  './js/tools/merge.js',
  './js/tools/metadata.js',
  './js/tools/ocr.js',
  './js/tools/pdf-utils.js',
  './js/tools/security.js',
  './js/tools/split.js',
  './js/tools/watermark.js',
  './js/ui/icons.js',
  './js/ui/ui.js',
  './js/utils/accessibility.js',
  './js/utils/browser.js',
  './js/utils/dom.js',
  './js/utils/files.js',
  './js/utils/marks.js',
  './js/utils/pdflib.js',
  './js/utils/security.js',
  './js/utils/urls.js',
  './js/utils/zip.js',
  './js/viewer/annotations.js',
  './js/viewer/forms.js',
  './js/viewer/keyboard.js',
  './js/viewer/navigation.js',
  './js/viewer/pdf-engine.js',
  './js/viewer/renderer.js',
  './js/viewer/search.js',
  './js/viewer/signatures.js',
  './js/viewer/thumbnails.js',
  './js/viewer/toolbar.js',
  './js/viewer/viewer.js',
  './vendor/pdf-lib/pdf-lib.min.js',
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
  './vendor/qpdf/qpdf.js',
  './vendor/qpdf/qpdf.wasm',
];
const SHELL = [...CORE, ...EXTRA];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Shell first: a handful of small files, so installation never blocks the first page.
    await Promise.all(CORE.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
    // Engine bundles are warmed in the background; the page never waits for them.
    warmExtra(cache);
  })());
});

/** Fill the rest of the shell cache quietly, one file at a time. */
async function warmExtra(cache) {
  for (const url of EXTRA) {
    try {
      if (await cache.match(url)) continue;
      await cache.add(url);
    } catch { /* offline or missing — try again on the next visit */ }
    await new Promise((r) => setTimeout(r, 40));
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never proxy or cache other origins — remote PDFs must be fetched live.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (/\.(?:css|js|mjs|svg|png|jpg|jpeg|webp|woff2?|json)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match('./offline.html'));
    return cached || new Response('You are offline and this page is not cached.', {
      status: 503, headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}
