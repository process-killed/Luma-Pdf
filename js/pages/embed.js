/**
 * Embed endpoint — a chrome-light viewer driven entirely by URL parameters,
 * controllable from the parent page through postMessage.
 */
import { openFromUrl, getDocumentInfo, enrichError, errorCode, getOutline } from '../viewer/pdf-engine.js';
import { Viewer } from '../viewer/viewer.js';
import { SearchController } from '../viewer/search.js';
import { ThumbnailPanel } from '../viewer/thumbnails.js';
import { AnnotationManager } from '../viewer/annotations.js';
import { Toolbar } from '../viewer/toolbar.js';
import { KeyController } from '../viewer/keyboard.js';
import { parseEmbedConfig } from '../embed/config.js';
import { EmbedBridge, allowedOriginsFromParams } from '../embed/messaging.js';
import { parseBool } from '../utils/urls.js';
import { icon } from '../ui/icons.js';
import { initMenus } from '../ui/ui.js';
import { applyTheme } from '../theme.js';
import { recommendProfile, profileConfig } from '../performance/device-detection.js';
import { detectDevice } from '../performance/device-detection.js';

const params = new URLSearchParams(location.search);
const { config, warnings, unknown } = parseEmbedConfig(params);
const S = { doc: null, viewer: null, search: null, thumbs: null, annots: null, toolbar: null, bridge: null, info: null };

const els = {};

function main() {
  els.app = document.getElementById('embed-app');
  els.toolbar = document.getElementById('embed-toolbar');
  els.workspace = document.getElementById('workspace');
  els.stack = document.getElementById('page-stack');
  els.sidebar = document.getElementById('embed-sidebar');
  els.status = document.getElementById('embed-status');
  els.statusCard = document.getElementById('embed-status-card');
  els.watermark = document.getElementById('watermark');

  if (config.language) document.documentElement.lang = config.language;
  applyTheme(config.theme);
  document.documentElement.dataset.readbg = config.background;

  if (config.watermark) {
    els.watermark.hidden = false;
    els.watermark.innerHTML = `<span>${escapeHtml(config.watermark)}</span>`;
  }

  if (config.sidebar) {
    els.sidebar.dataset.collapsed = 'false';
    S.sidebarOpen = true;
  }

  if (config.mobileToolbar) document.getElementById('embed-mobile').style.display = '';
  else document.getElementById('embed-mobile').style.display = 'none';

  buildToolbar();
  initMenus();
  wireMobile();
  wireSidebar();

  if (!config.file) {
    showMessage('No PDF specified', 'Add a <code>file</code> parameter with the URL of a PDF, for example <code>embed.html?file=https://example.com/report.pdf</code>.');
    ready();
    return;
  }

  loadDocument();
  installBridge();
  ready();
}

function ready() {
  // Announce readiness even before a document loads, so parents can queue commands.
  setTimeout(() => {
    S.bridge?.emit('luma:ready', { version: '1.0.0', config: publicConfig() });
  }, 30);
}

function publicConfig() {
  const { file, ...rest } = config;
  return rest;
}

/* ---------------- Toolbar ---------------- */
function buildToolbar() {
  if (!config.toolbar) {
    els.toolbar.style.display = 'none';
    return;
  }
  els.toolbar.dataset.compact = String(config.minimal);
  S.toolbar = new Toolbar(els.toolbar, {
    title: true,
    sidebar: config.sidebar,
    search: config.search,
    download: config.download && !config.readonly,
    print: config.print && !config.readonly,
    fullscreen: config.fullscreen,
    annotations: config.annotations && !config.readonly,
    navigation: config.navigation,
    moreMenu: false,
    onSidebar: toggleSidebar,
    onPrev: () => S.viewer?.prevPage(),
    onNext: () => S.viewer?.nextPage(),
    onGoTo: (n) => S.viewer?.goToPage(n),
    onZoomIn: () => S.viewer?.zoomIn().then(syncZoom),
    onZoomOut: () => S.viewer?.zoomOut().then(syncZoom),
    onZoom: (z) => S.viewer?.setZoom(z).then(syncZoom),
    onFit: (f) => S.viewer?.setZoom(f).then(syncZoom),
    onMode: (m) => { S.viewer?.setMode(m); S.toolbar.setMode(m); },
    onRotate: () => S.viewer?.rotate(90),
    onDirection: () => S.viewer?.setDirection(S.viewer.direction === 'rtl' ? 'ltr' : 'rtl'),
    onBackground: (bg) => { document.documentElement.dataset.readbg = bg; },
    onSearch: (term) => runSearch(term),
    onSearchNext: () => S.search?.next(),
    onSearchPrev: () => S.search?.prev(),
    onSearchClose: () => S.search?.clear(),
    onSearchOpen: () => S.toolbar.refs.searchInput?.focus(),
    onAnnotate: toggleAnnotations,
    onDownload: doDownload,
    onPrint: doPrint,
    onFullscreen: doFullscreen,
    onZen: () => { els.app.dataset.zen = els.app.dataset.zen === 'true' ? 'false' : 'true'; },
    onOpenFile: () => {},
    onOpenUrl: () => {},
    onCopyText: () => {},
    onExportText: () => {},
    onScreenshot: () => {},
    onExportPdf: () => {},
    onExportPages: () => {},
    onInfo: () => {},
    onSaveToLibrary: () => {}
  }).mount();
  S.toolbar.setMode(config.pageMode);
  S.toolbar.setDocument('Loading…', '');
  if (!config.hideLogo) {
    const brand = document.createElement('a');
    brand.className = 'embed-brand';
    brand.href = 'index.html';
    brand.target = '_blank';
    brand.rel = 'noopener';
    brand.title = 'Powered by Luma PDF';
    brand.innerHTML = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8.5" fill="#6e56cf"/><path d="M10.6 8h6.9l4.9 4.8V23a1.4 1.4 0 0 1-1.4 1.4H10.6A1.4 1.4 0 0 1 9.2 23V9.4A1.4 1.4 0 0 1 10.6 8z" fill="#fff"/></svg><span>Luma PDF</span>`;
    els.toolbar.append(brand);
  }
}

/* ---------------- Document ---------------- */
async function loadDocument() {
  showMessage('Loading document…', 'This may take a moment for large files.', true);
  try {
    const doc = await openFromUrl(config.file, {
      onProgress: (p) => showMessage('Loading document…', `${Math.round(p * 100)}% downloaded`, true, p)
    });
    S.doc = doc;
    els.status.hidden = true;

    const device = detectDevice();
    const profile = profileConfig(recommendProfile(device));

    S.viewer = new Viewer({
      workspace: els.workspace,
      stack: els.stack,
      doc,
      profile,
      mode: config.pageMode,
      zoom: config.zoom,
      direction: config.direction,
      gap: 14,
      onEvent: onViewerEvent
    });
    await S.viewer.init({ startPage: config.page });

    S.toolbar?.setDocument(filename(config.file), `${doc.numPages} pages`);
    S.toolbar?.setPage(S.viewer.current, doc.numPages);
    S.toolbar?.setZoom(Math.round(S.viewer.scale * 100));
    document.getElementById('mobile-total').textContent = '/ ' + doc.numPages;

    S.search = new SearchController({ doc, viewer: S.viewer, onState: onSearchState });

    if (config.annotations && !config.readonly) {
      S.annots = new AnnotationManager({ viewer: S.viewer, onChange: () => S.bridge?.emit('luma:annotationChanged', { count: S.annots.items.length }) });
      S.annots.attach();
      S.annots.enableSelectInteractions();
    }

    if (config.sidebar) {
      S.thumbs = new ThumbnailPanel({
        doc, viewer: S.viewer, container: document.getElementById('embed-thumbs'),
        profile, onSelect: (n) => { S.viewer.goToPage(n); closeSidebarMobile(); }
      });
      S.thumbs.build();
      loadOutline();
    }

    try {
      S.info = await getDocumentInfo(doc);
      S.bridge?.emit('luma:documentInfo', infoPayload());
    } catch { /* ignore */ }

    bindKeys();
    S.bridge?.emit('luma:loaded', { pages: doc.numPages, ...infoPayload() });
    if (warnings.length) console.warn('Luma PDF embed:', warnings.join(' '));
    if (unknown.length) console.info('Luma PDF embed: ignored unknown parameters:', unknown.join(', '));
  } catch (err) {
    const enriched = enrichError(err, { url: config.file });
    showMessage(
      errorCode(enriched) === 'NETWORK_CORS' ? 'The PDF could not be loaded' : 'This document could not be opened',
      enriched.message
    );
    S.bridge?.emit('luma:error', { code: errorCode(enriched), message: enriched.message });
  }
}

function filename(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'document.pdf');
    return /\.pdf$/i.test(name) ? name : name + '.pdf';
  } catch { return 'document.pdf'; }
}

function infoPayload() {
  return {
    pages: S.doc?.numPages || 0,
    page: S.viewer?.current || 1,
    title: S.info?.title || filename(config.file),
    author: S.info?.author || '',
    subject: S.info?.subject || '',
    creator: S.info?.creator || '',
    producer: S.info?.producer || '',
    file: config.file
  };
}

async function loadOutline() {
  const host = document.getElementById('embed-outline');
  try {
    const tree = await getOutline(S.doc);
    if (!tree.length) { host.innerHTML = `<div class="sidebar-empty">No outline in this PDF.</div>`; return; }
    const build = (items) => {
      const list = document.createElement('div');
      list.className = 'outline-list';
      items.forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'outline-item';
        btn.style.paddingLeft = `${8 + item.depth * 10}px`;
        btn.innerHTML = `<span class="truncate">${escapeHtml(item.title)}</span>${item.page ? `<span class="oi-page">${item.page}</span>` : ''}`;
        btn.addEventListener('click', () => { S.viewer.goToPage(item.page || 1); closeSidebarMobile(); });
        list.append(btn);
        if (item.children?.length) list.append(build(item.children));
      });
      return list;
    };
    host.replaceChildren(build(tree));
  } catch {
    host.innerHTML = `<div class="sidebar-empty">No outline in this PDF.</div>`;
  }
}

function onViewerEvent(type, detail) {
  if (type === 'pageChanged') {
    S.toolbar?.setPage(detail.page, detail.total);
    document.getElementById('mobile-page').value = String(detail.page);
    S.thumbs?.setCurrent(detail.page);
    S.bridge?.emit('luma:pageChanged', { page: detail.page, total: detail.total });
  } else if (type === 'zoomChanged') {
    S.toolbar?.setZoom(detail.percent);
    S.bridge?.emit('luma:zoomChanged', { percent: detail.percent, scale: detail.scale });
  } else if (type === 'modeChanged') {
    S.toolbar?.setMode(detail.mode);
  }
}

function syncZoom() {
  if (!S.viewer) return;
  S.toolbar?.setZoom(Math.round(S.viewer.scale * 100));
  S.search?.refresh();
  S.annots?.renderAll();
}

function runSearch(term) {
  if (!S.search) return;
  clearTimeout(runSearch._t);
  runSearch._t = setTimeout(async () => {
    const results = await S.search.run(term);
    S.bridge?.emit('luma:searchCompleted', { term, matches: results.length, page: results[0]?.page || null });
  }, 220);
}

function onSearchState({ results, active, done, term }) {
  if (!S.toolbar) return;
  if (!term) { S.toolbar.setSearchCount(''); return; }
  S.toolbar.setSearchCount(done ? (results.length ? `${active + 1}/${results.length}` : 'No matches') : '…');
}

/* ---------------- Chrome actions ---------------- */
function toggleSidebar() {
  if (window.innerWidth <= 860) {
    const open = els.sidebar.dataset.open === 'true';
    els.sidebar.dataset.open = String(!open);
    return;
  }
  const collapsed = els.sidebar.dataset.collapsed !== 'false';
  els.sidebar.dataset.collapsed = String(!collapsed);
  S.toolbar?.setSidebarPressed(!collapsed);
}

function closeSidebarMobile() {
  if (window.innerWidth <= 860) els.sidebar.dataset.open = 'false';
}

function wireSidebar() {
  document.querySelectorAll('#embed-sidebar .sb-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#embed-sidebar .sb-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      document.querySelectorAll('#embed-sidebar .sidebar-panel').forEach((p) => { p.dataset.active = String(p.dataset.panel === tab.dataset.tab); });
    });
  });
}

function wireMobile() {
  document.querySelectorAll('[data-mobile]').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.mobile;
      if (act === 'prev') S.viewer?.prevPage();
      else if (act === 'next') S.viewer?.nextPage();
      else if (act === 'search') S.toolbar?.openSearch();
      else if (act === 'panel') toggleSidebar();
    });
  });
  document.getElementById('mobile-page').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const n = Number.parseInt(e.target.value, 10);
      if (Number.isFinite(n)) S.viewer?.goToPage(n);
      e.target.blur();
    }
  });
}

function toggleAnnotations() {
  if (!S.annots) return;
  const bar = document.getElementById('annot-bar');
  if (bar) { bar.dataset.open = bar.dataset.open === 'true' ? 'false' : 'true'; return; }
  // Minimal annotation palette for embeds.
  const palette = document.createElement('div');
  palette.className = 'annot-bar';
  palette.id = 'annot-bar';
  palette.dataset.open = 'true';
  palette.innerHTML = `
    <button class="tb-btn" data-tool="select" aria-pressed="true" title="Select">${icon('move')}</button>
    <button class="tb-btn" data-tool="highlight" title="Highlight">${icon('highlighter')}</button>
    <button class="tb-btn" data-tool="pen" title="Pen">${icon('pen')}</button>
    <button class="tb-btn" data-tool="rect" title="Rectangle">${icon('square')}</button>
    <button class="tb-btn" data-tool="text" title="Text">${icon('type')}</button>
    <span class="tb-sep"></span>
    <button class="tb-btn" data-tool="undo" title="Undo">${icon('undo')}</button>
    <button class="tb-btn" data-tool="delete" title="Delete selected">${icon('trash')}</button>`;
  els.toolbar.after(palette);
  palette.querySelectorAll('[data-tool]').forEach((b) => {
    b.addEventListener('click', () => {
      const t = b.dataset.tool;
      if (t === 'undo') { S.annots.undo(); return; }
      if (t === 'delete') { S.annots.deleteSelected(); return; }
      S.annots.setTool(t);
      palette.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
  });
  S.toolbar.setAnnotPressed(true);
}

async function doDownload() {
  try {
    const res = await fetch(config.file, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename(config.file);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    console.warn('Download failed', e);
    window.open(config.file, '_blank', 'noopener');
  }
}

function doPrint() {
  window.print();
}

async function doFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await els.app.requestFullscreen();
      S.toolbar?.setFullscreen(true);
      S.bridge?.emit('luma:fullscreenChanged', { fullscreen: true });
    } else {
      await document.exitFullscreen();
      S.toolbar?.setFullscreen(false);
      S.bridge?.emit('luma:fullscreenChanged', { fullscreen: false });
    }
  } catch { /* ignore */ }
}

/* ---------------- Messaging ---------------- */
function installBridge() {
  S.bridge = new EmbedBridge({
    setPage: (p) => {
      const page = Number(p?.page ?? p);
      if (Number.isFinite(page)) S.viewer?.goToPage(page);
      return { page: S.viewer?.current || 1 };
    },
    setZoom: (p) => {
      const zoom = p?.zoom ?? p;
      if (zoom != null) S.viewer?.setZoom(String(zoom)).then(syncZoom);
      return { zoom: S.viewer ? Math.round(S.viewer.scale * 100) : 100 };
    },
    nextPage: () => { S.viewer?.nextPage(); return { page: S.viewer?.current }; },
    previousPage: () => { S.viewer?.prevPage(); return { page: S.viewer?.current }; },
    searchText: (p) => {
      const term = String(p?.text ?? p ?? '');
      S.search?.run(term);
      return { term };
    },
    print: () => { doPrint(); return { ok: true }; },
    download: () => { doDownload(); return { ok: true }; },
    toggleSidebar: () => { toggleSidebar(); return { sidebar: els.sidebar.dataset.collapsed !== 'false' }; },
    toggleFullscreen: () => { doFullscreen(); return { fullscreen: !!document.fullscreenElement }; },
    getDocumentInfo: () => infoPayload(),
    setTheme: (p) => {
      const theme = String(p?.theme ?? p ?? 'auto');
      applyTheme(theme);
      return { theme };
    },
    open: (p) => {
      const url = String(p?.url ?? p ?? '');
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs can be opened.');
      location.replace(`embed.html?file=${encodeURIComponent(url)}`);
      return { url };
    }
  }, { allowOrigins: allowedOriginsFromParams(params) }).install();

  document.addEventListener('fullscreenchange', () => {
    S.toolbar?.setFullscreen(!!document.fullscreenElement);
    S.bridge?.emit('luma:fullscreenChanged', { fullscreen: !!document.fullscreenElement });
  });
}

function bindKeys() {
  new KeyController({
    next: () => S.viewer?.nextPage(),
    prev: () => S.viewer?.prevPage(),
    first: () => S.viewer?.firstPage(),
    last: () => S.viewer?.lastPage(),
    search: () => S.toolbar?.openSearch(),
    print: () => doPrint(),
    save: () => doDownload(),
    zoomIn: () => S.viewer?.zoomIn().then(syncZoom),
    zoomOut: () => S.viewer?.zoomOut().then(syncZoom),
    fitWidth: () => S.viewer?.fitWidth().then(syncZoom),
    fitPage: () => S.viewer?.fitPage().then(syncZoom),
    escape: () => { if (document.fullscreenElement) document.exitFullscreen(); else S.toolbar?.closeSearch(); },
    sidebar: () => toggleSidebar(),
    fullscreen: () => doFullscreen(),
    rotate: () => S.viewer?.rotate(90)
  }).attach();
}

/* ---------------- Status ---------------- */
function showMessage(title, message, busy = false, progress = null) {
  els.status.hidden = false;
  els.statusCard.innerHTML = `
    ${busy ? `<div class="row" style="justify-content:center;margin-bottom:12px"><span class="spinner" style="width:20px;height:20px"></span></div>` : ''}
    <h2>${escapeHtml(title)}</h2>
    <p>${message}</p>
    ${progress !== null ? `<div class="status-progress" style="margin-top:14px"><div class="progress"><i style="width:${Math.round(progress * 100)}%"></i></div></div>` : ''}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main();
