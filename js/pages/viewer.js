/**
 * Viewer page — wires the PDF engine, viewer, toolbar, sidebar, search and annotations.
 */
import { boot } from '../app.js';
import { APP } from '../config.js';
import { store } from '../state.js';
import { ANNOTATION_TOOLS, ANNOTATION_COLORS, ZOOM_STEPS, FILE_LIMITS } from '../config.js';
import { icon } from '../ui/icons.js';
import { toast, dialog, confirmDialog, promptDialog, initMenus, copyText, setBusy } from '../ui/ui.js';
import { downloadBlob, pdfName, canvasToBlob, formatBytes, sanitizeFilename } from '../utils/files.js';
import { normalizeUrl, filenameFromUrl, getParams, parseIntSafe } from '../utils/urls.js';
import { openFromFile, openFromUrl, openFromBytes, getOutline, getDocumentInfo, pageText, documentText, enrichError, errorCode, renderPageOffscreen, engineReady, warmWorker } from '../viewer/pdf-engine.js';
import { Viewer } from '../viewer/viewer.js';
// Heavy, feature-only modules are imported on demand (see loadFeature).


import { Toolbar } from '../viewer/toolbar.js';
import { KeyController } from '../viewer/keyboard.js';



import { loadPdfLib } from '../utils/pdflib.js';
import { mark } from '../utils/marks.js';
import { getDocument, saveDocument, getAnnotations, saveAnnotations, getBookmarks, saveBookmarks, getReadingState, saveReadingState, touchDocument } from '../storage/library.js';
import { currentProfile } from '../app.js';

mark('module');
// Boot the PDF.js worker before anything else needs it.
warmWorker?.();
// pdf-lib (525 KB) is fetched only when a feature needs it — never on open.

/** Load a feature module the first time it is needed. */
const featureCache = new Map();
function loadFeature(path) {
  if (!featureCache.has(path)) featureCache.set(path, import(path));
  return featureCache.get(path);
}

const S = {
  doc: null, docKey: null, docName: '', source: null, blob: null,
  viewer: null, search: null, thumbs: null, annots: null, toolbar: null, keys: null,
  bookmarks: null, outline: [], info: null, profile: null, pendingFile: null
};

const els = {};

async function main() {
  els.app = document.getElementById('viewer-app');
  els.toolbar = document.getElementById('toolbar');
  els.annotBar = document.getElementById('annot-bar');
  els.workspace = document.getElementById('workspace');
  els.stack = document.getElementById('page-stack');
  els.sidebar = document.getElementById('sidebar');
  els.sidebarScrim = document.getElementById('sidebar-scrim');
  els.status = document.getElementById('status');
  els.statusCard = document.getElementById('status-card');
  els.pill = document.getElementById('page-pill');
  els.progress = document.getElementById('read-progress');
  els.fileInput = document.getElementById('file-input');
  els.drop = document.getElementById('viewer-drop');
  els.mobilePage = document.getElementById('mobile-page');
  els.mobileTotal = document.getElementById('mobile-total');

  const params = getParams();
  // Kick the document off first: its download and parse overlap with the UI boot.
  const preOpen = params.get('file')
    ? openFromUrl(params.get('file')).catch((err) => ({ __error: err }))
    : null;

  S.profile = (await boot({ active: 'viewer' })).profile;

  buildToolbar();
  wireSidebar();
  wireMobile();
  wireGlobalDrop();
  initMenus();

  if (params.get('doc')) {
    await openFromLibrary(params.get('doc'));
  } else if (params.get('file')) {
    await openRemote(params.get('file'), { page: parseIntSafe(params.get('page'), 0), preOpen });
  } else {
    showEmptyState();
  }
}

/* ---------------- Toolbar ---------------- */
function buildToolbar() {
  S.toolbar = new Toolbar(els.toolbar, {
    pan: true,
    onPan: togglePan,
    forms: true,
    onForms: toggleForms,
    onSidebar: toggleSidebar,
    onPrev: () => S.viewer?.prevPage(),
    onNext: () => S.viewer?.nextPage(),
    onGoTo: (n) => S.viewer?.goToPage(n),
    onZoomIn: () => S.viewer?.zoomIn().then(syncZoom),
    onZoomOut: () => S.viewer?.zoomOut().then(syncZoom),
    onZoom: (z) => S.viewer?.setZoom(z).then(syncZoom),
    onFit: (f) => S.viewer?.setZoom(f).then(syncZoom),
    onMode: (m) => { S.viewer?.setMode(m); store.set('mode', m); S.toolbar.setMode(m); },
    onBackground: (bg) => { store.set('readBg', bg); },
    onRotate: () => S.viewer?.rotate(90),
    onDirection: () => {
      const dir = S.viewer?.direction === 'rtl' ? 'ltr' : 'rtl';
      S.viewer?.setDirection(dir);
      store.set('direction', dir);
      toast(dir === 'rtl' ? 'Right-to-left reading' : 'Left-to-right reading', { duration: 1600 });
    },
    onSearch: (term) => runSearch(term),
    onSearchNext: () => S.search?.next(),
    onSearchPrev: () => S.search?.prev(),
    onSearchClose: () => S.search?.clear(),
    onSearchOpen: () => S.toolbar.refs.searchInput?.focus(),
    onAnnotate: toggleAnnotations,
    onDownload: downloadOriginal,
    onPrint: printDocument,
    onFullscreen: toggleFullscreen,
    onZen: () => setZen(els.app.dataset.zen !== 'true'),
    onOpenFile: () => els.fileInput.click(),
    onOpenUrl: promptOpenUrl,
    onCopyText: copyPageText,
    onExportText: exportText,
    onScreenshot: savePageImage,
    onExportPdf: exportAnnotatedPdf,
    onExportPages: exportPageRange,
    onInfo: showInfoDialog,
    onSaveToLibrary: saveToLibrary
  }).mount();
  S.toolbar.setMode(store.get('mode') || 'vertical');
}

/** Distraction-free mode, with a way out that works without a mouse. */
function setZen(on) {
  els.app.dataset.zen = on ? 'true' : 'false';
  let exit = document.getElementById('zen-exit');
  if (on && !exit) {
    exit = document.createElement('button');
    exit.id = 'zen-exit';
    exit.className = 'zen-exit';
    exit.type = 'button';
    exit.innerHTML = `${icon('chevron-down', 'icon-sm')}<span>Exit</span>`;
    exit.setAttribute('aria-label', 'Leave distraction-free mode');
    exit.addEventListener('click', (e) => { e.stopPropagation(); setZen(false); });
    els.app.append(exit);
  } else if (!on && exit) {
    exit.remove();
  }
  if (on) toast('Distraction-free mode — tap “Exit” (or the top edge) to bring the toolbar back', { duration: 3000 });
}

/** A tap in the top strip restores the toolbar, the touch equivalent of hovering it. */
function watchZenEdge() {
  els.app.addEventListener('pointerdown', (e) => {
    if (els.app.dataset.zen !== 'true') return;
    if (e.clientY > 64) return;
    setZen(false);
  }, { passive: true });
}

/** Cheap byte sniff: a PDF with form fields mentions /AcroForm in its objects. */
function hasAcroForm(bytes) {
  if (!bytes || !bytes.length) return false;
  const probe = bytes.length > 2_000_000 ? bytes.subarray(0, 2_000_000) : bytes;
  let text = '';
  const chunk = 0x8000;
  for (let i = 0; i < probe.length; i += chunk) {
    text += String.fromCharCode.apply(null, probe.subarray(i, i + chunk));
    if (text.includes('/AcroForm')) return true;
    if (text.length > 4_000_000) text = text.slice(-2000);
  }
  return false;
}

function togglePan() {
  if (!S.viewer) return;
  const on = !S.viewer.panMode;
  S.viewer.setPanMode(on);
  S.toolbar.setPanPressed(on);
  if (on) setTool('select');
  toast(on
    ? 'Hand tool on — drag to move the page (or hold Space to pan temporarily)'
    : 'Hand tool off', { duration: 2400 });
}

/**
 * Form detection is deferred: parsing the whole document with pdf-lib costs more than
 * the first page render on a phone. We sniff the raw bytes for an /AcroForm entry first,
 * then do the real work on idle.
 */
async function loadForms() {
  if (!S.doc) return;
  try {
    const bytes = await sourceBytes();
    // A quick byte sniff catches most files; object streams hide /AcroForm, so small
    // documents are checked properly as well (large ones are not worth the parse).
    const worthParsing = hasAcroForm(bytes) || bytes.length < 8 * 1024 * 1024;
    if (!worthParsing) return;
    // Wait for a quiet moment: parsing a form with pdf-lib is a long task and would
    // show up as a slow first tap if it ran while the reader is scrolling.
    await new Promise((resolve) => {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
      idle(resolve, { timeout: 2500 });
    });
    if (S.forms || !S.doc) return;
    await loadPdfLib();
    const { FormLayer } = await loadFeature('../viewer/forms.js');
    S.forms = new FormLayer({
      viewer: S.viewer,
      onChange: (form) => paintFormBar(form)
    });
    const count = await S.forms.load(bytes);
    if (!count) return;
    S.toolbar.showForms(count);
    paintFormBar(S.forms);
    toast(`This PDF has ${count} fillable field${count === 1 ? '' : 's'}. Click the pen-and-form button to fill them.`, {
      type: 'info', duration: 5200,
      action: { label: 'Fill now', onClick: () => toggleForms() }
    });
  } catch { /* no form layer available (CORS, encryption, or no fields) */ }
}

function toggleForms() {
  if (!S.forms?.hasFields) {
    toast('This PDF has no fillable form fields.', { type: 'info', duration: 2400 });
    return;
  }
  const on = !S.forms.visible;
  S.forms.setVisible(on);
  S.toolbar.setFormsPressed(on);
  paintFormBar(S.forms);
  if (on) {
    const { fields } = S.forms.summary();
    toast(`${fields} field${fields === 1 ? '' : 's'} — fill them in, then save a copy.`, { duration: 3000 });
  }
}

function paintFormBar(form) {
  let bar = document.getElementById('form-bar');
  const active = form && form.hasFields && form.visible;
  if (!active) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'form-bar';
    bar.id = 'form-bar';
    bar.innerHTML = `<span class="form-bar-text"></span>
      <button class="btn btn-ghost btn-sm" data-form="clear">Clear</button>
      <button class="btn btn-primary btn-sm" data-form="save">${icon('save', 'icon-sm')}Save filled PDF</button>`;
    els.workspace.append(bar);
    bar.querySelector('[data-form="save"]').addEventListener('click', saveFilledForm);
    bar.querySelector('[data-form="clear"]').addEventListener('click', () => {
      S.forms.values.clear();
      S.forms.fields.forEach((f) => S.forms.values.set(f.id, f.type === 'PDFCheckBox' ? false : ''));
      S.forms.fields.forEach((f) => S.forms.renderPage(f.page));
      paintFormBar(S.forms);
    });
  }
  const { filled, fields } = form.summary();
  bar.querySelector('.form-bar-text').textContent = `${filled} of ${fields} filled`;
}

async function saveFilledForm() {
  if (!S.forms?.hasFields) return;
  await loadPdfLib();
  const body = document.createElement('div');
  body.innerHTML = `<p class="small muted" style="line-height:1.6">The values are written into a new copy of the PDF. Your original file is untouched.</p>
    <label class="checkbox" style="margin-top:12px"><input type="checkbox" id="form-flatten" checked> Flatten the form (recommended — every reader then shows the values)</label>
    <p class="hint" style="margin-top:8px">Flattening removes the ability to edit the fields later. Uncheck it if the recipient must still fill something in.</p>`;
  const ok = await dialog({
    title: 'Save the filled PDF',
    sub: `${S.forms.filledCount} of ${S.forms.count} fields filled`,
    body,
    actions: [
      { label: 'Cancel', value: false, variant: 'ghost' },
      { label: 'Save a copy', value: true, variant: 'primary' }
    ]
  });
  if (!ok) return;
  const flatten = body.querySelector('#form-flatten').checked;
  const stop = toast('Writing the form values…', { duration: 0 });
  try {
    const { bytes, applied } = await S.forms.save({ flatten });
    const name = pdfName(S.docName || 'document', '-filled');
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), name);
    stop.close();
    toast(`${applied} field${applied === 1 ? '' : 's'} saved into ${name}`, { type: 'success', duration: 5000 });
  } catch (e) {
    stop.close();
    toast('Could not save the form: ' + e.message, { type: 'error', duration: 7000 });
  }
}

function syncZoom() {
  if (!S.viewer) return;
  S.toolbar.setZoom(Math.round(S.viewer.scale * 100));
  // Annotation layers are scaled with one CSS transform; no DOM rebuild needed.
  S.annots?.syncZoom();
}

/* ---------------- Annotation palette ---------------- */
function buildAnnotBar() {
  els.annotBar.innerHTML = `
    <div class="tb-group" id="annot-tools"></div>
    <span class="tb-sep"></span>
    <div class="tb-group" id="annot-colors"></div>
    <span class="tb-sep"></span>
    <label class="row small muted" style="gap:6px;padding:0 4px" title="Stroke thickness">
      <span class="width-preview" id="width-preview"></span>
      <input type="range" min="1" max="12" step="0.5" value="2" id="annot-width" aria-label="Stroke thickness">
    </label>
    <label class="row small muted" style="gap:6px;padding:0 4px" title="Annotation opacity">
      ${icon('eye', 'icon-sm')}
      <input type="range" min="10" max="100" step="5" value="100" id="annot-opacity" aria-label="Annotation opacity" style="width:64px">
    </label>
    <span class="tb-sep"></span>
    <button class="tb-btn" data-annot="signature" title="Draw a signature">${icon('signature')}</button>
    <button class="tb-btn" data-annot="image" title="Place an image">${icon('image')}</button>
    <span class="tb-sep"></span>
    <button class="tb-btn" data-annot="undo" title="Undo">${icon('undo')}</button>
    <button class="tb-btn" data-annot="redo" title="Redo">${icon('redo')}</button>
    <button class="tb-btn" data-annot="duplicate" title="Duplicate selected (Ctrl+D)">${icon('copy')}</button>
    <button class="tb-btn" data-annot="delete" title="Delete selected (Del)">${icon('trash')}</button>
    <button class="tb-btn" data-annot="clear" title="Clear page annotations">${icon('x')}</button>
    <span class="tb-sep"></span>
    <button class="tb-btn" data-annot="save-pdf" title="Write annotations into a PDF">${icon('save')}</button>`;

  const tools = els.annotBar.querySelector('#annot-tools');
  ANNOTATION_TOOLS.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'tb-btn';
    b.type = 'button';
    b.dataset.tool = t.id;
    b.title = t.hint;
    b.setAttribute('aria-label', t.label);
    b.innerHTML = icon(t.icon);
    b.addEventListener('click', () => setTool(t.id));
    tools.append(b);
  });

  const colors = els.annotBar.querySelector('#annot-colors');
  ANNOTATION_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'tb-btn';
    b.type = 'button';
    b.style.padding = '0 3px';
    b.setAttribute('aria-pressed', c === '#f2c744' ? 'true' : 'false');
    b.setAttribute('aria-label', 'Colour ' + c);
    b.innerHTML = `<span class="color-swatch" style="background:${c}"></span>`;
    b.addEventListener('click', () => {
      colors.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      S.annots?.setColor(c);
    });
    colors.append(b);
  });

  els.annotBar.querySelector('#annot-width').addEventListener('input', (e) => {
    S.annots?.setStrokeWidth(Number(e.target.value));
    els.annotBar.querySelector('#width-preview').innerHTML = `<span style="display:block;width:14px;height:${e.target.value}px;background:currentColor;border-radius:2px"></span>`;
  });
  els.annotBar.querySelector('#annot-opacity').addEventListener('input', (e) => {
    S.annots?.setOpacity(Number(e.target.value) / 100);
  });

  els.annotBar.querySelectorAll('[data-annot]').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.annot;
      if (act === 'undo') { S.annots?.undo(); renderAnnotList(); }
      else if (act === 'redo') { S.annots?.redo(); renderAnnotList(); }
      else if (act === 'duplicate') S.annots?.duplicateSelected();
      else if (act === 'delete') S.annots?.deleteSelected();
      else if (act === 'clear') clearPageAnnotations();
      else if (act === 'signature') drawSignature();
      else if (act === 'image') pickImage();
      else if (act === 'save-pdf') exportAnnotatedPdf();
    });
  });
  setTool('select');
}

function useTool(id) {
  if (!S.annots) return;
  ensureAnnotBar();
  if (els.annotBar.dataset.open !== 'true') {
    els.annotBar.dataset.open = 'true';
    S.toolbar?.setAnnotPressed(true);
  }
  setTool(id);
}

function setTool(id) {
  if (!S.annots) return;
  S.annots.setTool(id);
  els.annotBar.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
}

/* ---------------- Sidebar ---------------- */
function wireSidebar() {
  document.querySelectorAll('.sb-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab, { userInitiated: true }));
  });
  els.sidebarScrim.addEventListener('click', () => closeSidebarMobile());
}

function switchTab(name, { userInitiated = false } = {}) {
  document.querySelectorAll('.sb-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('.sidebar-panel').forEach((p) => { p.dataset.active = String(p.dataset.panel === name); });
  store.set('sidebarTab', name);
  if (name === 'thumbs' && S.thumbs && !S.thumbs.buttons.length) S.thumbs.build();
  if (name === 'outline') renderOutline();
  if (name === 'bookmarks') renderBookmarks();
  if (name === 'annotations') renderAnnotList();
  if (name === 'info') renderInfo();
  if (userInitiated) openSidebarMobile();
}

function isSidebarVisible() {
  const mobile = window.matchMedia('(max-width: 860px)').matches;
  if (mobile) return els.sidebar.dataset.open === 'true';
  return els.sidebar.dataset.collapsed !== 'true';
}

function toggleSidebar() {
  if (window.innerWidth <= 860) {
    const open = els.sidebar.dataset.open === 'true';
    els.sidebar.dataset.open = String(!open);
    els.sidebarScrim.dataset.open = String(!open);
    S.toolbar.setSidebarPressed(!open);
    return;
  }
  const collapsed = els.sidebar.dataset.collapsed === 'true';
  els.sidebar.dataset.collapsed = String(!collapsed);
  S.toolbar.setSidebarPressed(collapsed);
}

function openSidebarMobile() {
  if (window.innerWidth > 860) return;
  els.sidebar.dataset.open = 'true';
  els.sidebarScrim.dataset.open = 'true';
}
function closeSidebarMobile() {
  els.sidebar.dataset.open = 'false';
  els.sidebarScrim.dataset.open = 'false';
}

function wireMobile() {
  document.querySelectorAll('[data-mobile]').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.mobile;
      if (act === 'prev') S.viewer?.prevPage();
      else if (act === 'next') S.viewer?.nextPage();
      else if (act === 'search') { S.toolbar.openSearch(); }
      else if (act === 'annotate') toggleAnnotations();
      else if (act === 'panel') toggleSidebar();
    });
  });
  els.mobilePage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const n = Number.parseInt(els.mobilePage.value, 10);
      if (Number.isFinite(n)) S.viewer?.goToPage(n);
      els.mobilePage.blur();
    }
  });
}

/* ---------------- Open documents ---------------- */
function showEmptyState() {
  els.status.hidden = false;
  els.statusCard.innerHTML = `
    <h2>Open a PDF to begin</h2>
    <p>Drop a file anywhere in this window, choose one from your device, or paste a link to a PDF.</p>
    <div class="status-actions">
      <button class="btn btn-primary" id="status-open">Choose a file</button>
      <button class="btn btn-outline" id="status-url">Open a link</button>
    </div>
    <p class="hint" style="margin-top:14px">Files are decoded on this device and never uploaded.</p>`;
  els.statusCard.querySelector('#status-open').addEventListener('click', () => els.fileInput.click());
  els.statusCard.querySelector('#status-url').addEventListener('click', promptOpenUrl);
}

function showLoading(name, progress = null) {
  els.status.hidden = false;
  els.statusCard.innerHTML = `
    <div class="row" style="justify-content:center;margin-bottom:14px"><span class="spinner" style="width:22px;height:22px"></span></div>
    <h2>Opening ${escapeHtml(name || 'document')}</h2>
    <p class="muted small">${progress === null ? 'Reading the document…' : `Downloading… ${Math.round(progress * 100)}%`}</p>
    <div class="status-progress"><div class="progress ${progress === null ? 'progress-indeterminate' : ''}"><i style="width:${progress === null ? 0 : Math.round(progress * 100)}%"></i></div></div>`;
}

function showError(err, context = {}) {
  const code = errorCode(err);
  const message = err?.message || String(err);
  els.status.hidden = false;
  const hints = {
    NETWORK_CORS: `The PDF server must allow this site to read the file. Add
<code>Access-Control-Allow-Origin: *</code> (or your domain) to the server's response headers.
Browsers block cross-origin PDF reads without it, and no client-side app can override that.`,
    PASSWORD_REQUIRED: 'The document is encrypted. Enter its password to continue.',
    INVALID_PDF: 'The file is damaged or is not a PDF. Try re-downloading it.',
    NOT_PDF: 'That address did not return a PDF. Check the link points directly at a .pdf file.'
  };
  els.statusCard.innerHTML = `
    <h2>${code === 'PASSWORD_REQUIRED' ? 'Password required' : 'This document could not be opened'}</h2>
    <p>${escapeHtml(message)}</p>
    ${hints[code] ? `<div class="status-code">${hints[code]}</div>` : ''}
    <div class="status-actions">
      ${code === 'PASSWORD_REQUIRED' ? '<button class="btn btn-primary" id="status-password">Enter password</button>' : ''}
      ${context.retry ? '<button class="btn btn-outline" id="status-retry">Try again</button>' : ''}
      <button class="btn btn-outline" id="status-open">Open another file</button>
      <a class="btn btn-ghost" href="docs.html#cors">Why does this happen?</a>
    </div>`;
  els.statusCard.querySelector('#status-open').addEventListener('click', () => els.fileInput.click());
  els.statusCard.querySelector('#status-retry')?.addEventListener('click', context.retry);
  els.statusCard.querySelector('#status-password')?.addEventListener('click', () => askPassword(context));
}

async function askPassword(context) {
  const body = document.createElement('div');
  body.innerHTML = `<div class="field"><label class="label" for="pdf-pass">Document password</label>
      <input class="input" id="pdf-pass" type="password" autocomplete="off" spellcheck="false">
      <span class="hint">The password is used on this device only and is never stored.</span></div>`;
  const ok = await dialog({
    title: 'Password required',
    sub: 'This PDF is encrypted.',
    body,
    actions: [
      { label: 'Cancel', value: false, variant: 'ghost' },
      { label: 'Unlock', value: true, variant: 'primary', onClick: (dlg) => !!dlg.querySelector('#pdf-pass').value }
    ],
    onMount: (dlg) => {
      dlg.querySelector('#pdf-pass').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); dlg.querySelector('.modal-foot .btn-primary').click(); }
      });
    }
  });
  if (!ok) return;
  const password = body.querySelector('#pdf-pass').value;
  await context.retryWithPassword?.(password);
}

async function openFromLibrary(id) {
  try {
    const rec = await getDocument(id);
    if (!rec || !rec.blob) {
      toast('That saved document is no longer in this browser.', { type: 'error' });
      showEmptyState();
      return;
    }
    const file = new File([rec.blob], rec.name, { type: 'application/pdf' });
    S.blob = file;
    S.docName = rec.name;
    S.docKey = rec.id;
    S.source = { kind: 'library', id: rec.id };
    showLoading(rec.name);
    const doc = await openFromFile(file, { onProgress: (p) => showLoading(rec.name, p) });
    touchDocument(rec.id, {}).catch(() => {});
    await onDocumentReady(doc, { name: rec.name, size: file.size });
  } catch (err) {
    const enriched = enrichError(err);
    showError(enriched, { retry: () => openFromLibrary(id) });
  }
}

async function openRemote(rawUrl, { page = 0, preOpen = null } = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    toast('Enter a full http:// or https:// link to a PDF.', { type: 'error' });
    return;
  }
  const name = filenameFromUrl(url);
  S.docName = name;
  S.docKey = 'url:' + url;
  S.source = { kind: 'url', url };
  S.blob = null;
  showLoading(name, 0);
  mark('doc-request');
  try {
    const doc = preOpen ? await preOpen : await openFromUrl(url, { onProgress: (p) => showLoading(name, p) });
    if (doc && doc.__error) throw doc.__error;
    await onDocumentReady(doc, { name, page });
  } catch (err) {
    const enriched = enrichError(err, { url });
    showError(enriched, {
      retry: () => openRemote(url, { page }),
      retryWithPassword: async (password) => {
        showLoading(name);
        try {
          const doc = await openFromUrl(url, { password });
          await onDocumentReady(doc, { name });
        } catch (e) {
          showError(enrichError(e, { url }), {
            retry: () => openRemote(url, { page }),
            retryWithPassword: (pw) => { S._pw = pw; openRemote(url, { page }); }
          });
        }
      }
    });
  }
}

async function onDocumentReady(doc, { name, size = 0, page = 0 } = {}) {
  S.doc = doc;
  els.status.hidden = true;

  let info = null;
  const infoPromise = getDocumentInfo(doc).catch(() => null);

  const restore = store.get('restorePosition') ? await getReadingState(S.docKey).catch(() => null) : null;
  const startPage = page || restore?.page || 1;

  S.viewer = new Viewer({
    workspace: els.workspace,
    stack: els.stack,
    doc,
    profile: S.profile,
    mode: store.get('mode') || 'vertical',
    zoom: store.get('zoom') || 'page-width',
    direction: store.get('direction') || 'ltr',
    gap: store.get('gap') || 14,
    onEvent: onViewerEvent
  });
  mark('viewer-init-start');
  await S.viewer.init({ startPage });
  mark('viewer-init');

  S.toolbar.setDocument(name || info?.title || 'Untitled document', `${doc.numPages} pages${size ? ' · ' + formatBytes(size) : ''}`);
  S.toolbar.setMode(S.viewer.mode);
  S.toolbar.setPage(S.viewer.current, doc.numPages);
  S.toolbar.setZoom(Math.round(S.viewer.scale * 100));
  els.mobileTotal.textContent = '/ ' + doc.numPages;
  els.mobilePage.value = String(S.viewer.current);

  const { SearchController } = await loadFeature('../viewer/search.js');
  S.search = new SearchController({
    doc,
    viewer: S.viewer,
    onState: onSearchState
  });

  const { AnnotationManager } = await loadFeature('../viewer/annotations.js');
  S.annots = new AnnotationManager({
    viewer: S.viewer,
    onChange: (items) => {
      // Persist lazily: a stroke or a drag fires many small changes.
      clearTimeout(S._saveAnnTimer);
      S._saveAnnTimer = setTimeout(() => {
        if (S.docKey) saveAnnotations(S.docKey, S.annots.items).catch(() => {});
      }, 500);
      clearTimeout(S._annotListTimer);
      S._annotListTimer = setTimeout(renderAnnotList, 220);
    },
    onSelect: () => {}
  });
  S.annots.attach();
  S.annots.enableSelectInteractions();
  S.annots.syncZoom();
  try {
    const saved = S.docKey ? await getAnnotations(S.docKey) : [];
    if (saved.length) {
      S.annots.load(saved);
      toast(`${saved.length} saved annotation${saved.length === 1 ? '' : 's'} restored`, { type: 'info', duration: 2600 });
    }
  } catch { /* ignore */ }

  const { ThumbnailPanel } = await loadFeature('../viewer/thumbnails.js');
  S.thumbs = new ThumbnailPanel({
    doc, viewer: S.viewer, container: document.getElementById('panel-thumbs'),
    profile: S.profile, onSelect: (n) => { S.viewer.goToPage(n); closeSidebarMobile(); }
  });
  // Thumbnails are built lazily by switchTab() once the sidebar is shown.

  S.outline = [];
  S.bookmarks = null;   // created in hydratePanels() once the first page is up

  // Small debug/integration surface (also used by the embed bridge).
  window.LumaPDF = { viewer: S.viewer, doc: S.doc, search: S.search, annots: S.annots, state: S, version: APP.version };
  mark('doc-open');

  // Metadata and document details arrive after the first page, never before it.
  infoPromise.then((value) => {
    if (!value || S.doc !== doc) return;
    S.info = value;
    renderInfo();
    S.toolbar.setDocument(name || value.title || 'Untitled document', `${doc.numPages} pages${size ? ' · ' + formatBytes(size) : ''}`);
  });

  renderInfo();
  renderAnnotList();
  loadForms();
  bindKeys();
  attachPersistence();
  watchZenEdge();
  // A dropdown and the annotation palette must never be open at the same time.
  document.addEventListener('luma:menu-open', () => {
    // Close the palette directly: calling toggleAnnotations() would close the menu we
    // are reacting to.
    if (els.annotBar.dataset.open === 'true') {
      els.annotBar.dataset.open = 'false';
      S.toolbar?.setAnnotPressed(false);
    }
  });
  document.title = `${name} — Luma PDF`;

  // Panels are secondary: hydrate them once the first page is on screen so the
  // document never waits on thumbnails, the outline or stored bookmarks.
  hydratePanels();
}

async function hydratePanels() {
  await new Promise((r) => setTimeout(r, 60));
  try {
    S.outline = await getOutline(S.doc);
    renderOutline();
  } catch { S.outline = []; renderOutline(); }
  try {
    const saved = S.docKey ? await getBookmarks(S.docKey) : [];
    const { BookmarkStore } = await loadFeature('../viewer/navigation.js');
    S.bookmarks = new BookmarkStore({
      docKey: S.docKey,
      bookmarks: saved || [],
      onChange: (items) => { saveBookmarks(S.docKey, items).catch(() => {}); renderBookmarks(); }
    });
    renderBookmarks();
  } catch { renderBookmarks(); }
  switchTab(store.get('sidebarTab') || 'thumbs');
}

/* ---------------- Viewer events ---------------- */
let saveTimer = 0;
function onViewerEvent(type, detail) {
  if (!S.viewer) return;
  if (type === 'pageChanged') {
    S.toolbar.setPage(detail.page, detail.total);
    els.mobilePage.value = String(detail.page);
    els.pill.textContent = `Page ${detail.page} of ${detail.total}`;
    els.pill.dataset.visible = 'true';
    clearTimeout(els.pill._t);
    els.pill._t = setTimeout(() => { els.pill.dataset.visible = 'false'; }, 1200);
    S.thumbs?.setCurrent(detail.page);
    S.annots?.renderPage(detail.page);
    S.forms?.renderPage(detail.page);
    els.progress.style.width = `${(detail.page / detail.total) * 100}%`;
    scheduleSave();
  } else if (type === 'zoomChanged') {
    S.toolbar.setZoom(detail.percent);
    S.annots?.syncZoom();
    S.forms?.syncZoom();
    scheduleSave();
  } else if (type === 'zoomSettled') {
    S.toolbar.setZoom(detail.percent);
    S.annots?.syncZoom();
    S.forms?.syncZoom();
    S.search?.refresh();
  } else if (type === 'pageRendered') {
    if (!S._firstPaint) { S._firstPaint = true; mark('first-page'); }
    if (S.forms?.visible) S.forms.renderPage(detail.page);
  } else if (type === 'scroll') {
    els.progress.style.width = `${detail.progress * 100}%`;
  } else if (type === 'modeChanged') {
    S.toolbar.setMode(detail.mode);
    S.annots?.renderAll();
    S.search?.refresh();
  }
}

function attachPersistence() {
  window.addEventListener('beforeunload', () => { savePositionNow(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePositionNow(); });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePositionNow, 1200);
}

function savePositionNow() {
  if (!S.viewer || !S.docKey) return;
  saveReadingState(S.docKey, {
    page: S.viewer.current,
    total: S.doc.numPages,
    zoom: S.viewer.zoomSpec,
    mode: S.viewer.mode,
    progress: S.viewer.current / Math.max(1, S.doc.numPages)
  }).catch(() => {});
}

/* ---------------- Search ---------------- */
function focusSearch() {
  S.toolbar.openSearch();
  S.toolbar.refs.searchInput?.focus();
}

function runSearch(term) {
  if (!S.search) return;
  if (!term.trim()) { S.search.clear(); return; }
  clearTimeout(runSearch._t);
  runSearch._t = setTimeout(() => {
    S.search.run(term, { caseSensitive: false, wholeWord: false });
  }, 220);
}

function onSearchState({ term, results, active, done, progress }) {
  if (!S.toolbar) return;
  if (!term) { S.toolbar.setSearchCount(''); return; }
  if (!done) {
    S.toolbar.setSearchCount(results.length ? `${results.length}…` : '…');
    return;
  }
  S.toolbar.setSearchCount(results.length ? `${active + 1}/${results.length}` : 'No matches');
}

/* ---------------- Panels ---------------- */
function renderOutline() {
  const host = document.getElementById('panel-outline');
  if (!S.outline || !S.outline.length) {
    host.innerHTML = `<div class="sidebar-empty">This PDF has no embedded outline (bookmarks).</div>`;
    return;
  }
  host.replaceChildren(buildOutlineList(S.outline));
}

function buildOutlineList(items) {
  const list = document.createElement('div');
  list.className = 'outline-list';
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'outline-item';
    btn.style.paddingLeft = `${8 + item.depth * 10}px`;
    btn.innerHTML = `<span class="truncate">${escapeHtml(item.title)}</span>${item.page ? `<span class="oi-page">${item.page}</span>` : ''}`;
    if (item.page) btn.addEventListener('click', () => { S.viewer.goToPage(item.page); closeSidebarMobile(); });
    else btn.disabled = true;
    list.append(btn);
    if (item.children?.length) {
      const child = buildOutlineList(item.children);
      child.classList.add('outline-children');
      list.append(child);
    }
  });
  return list;
}

function renderBookmarks() {
  const host = document.getElementById('panel-bookmarks');
  const items = S.bookmarks?.items || [];
  host.innerHTML = `
    <div class="row-between" style="margin-bottom:8px">
      <span class="small muted">${items.length} bookmark${items.length === 1 ? '' : 's'}</span>
      <button class="btn btn-ghost btn-sm" id="bm-add">${icon('plus', 'icon-sm')}This page</button>
    </div>
    <div class="side-list" id="bm-list"></div>`;
  host.querySelector('#bm-add').addEventListener('click', () => {
    if (!S.viewer) return;
    S.bookmarks.toggle(S.viewer.current, `Page ${S.viewer.current}`);
    toast('Bookmark saved for this page', { type: 'success', duration: 1800 });
  });
  const list = host.querySelector('#bm-list');
  if (!items.length) {
    list.innerHTML = `<div class="sidebar-empty">No bookmarks yet. Add one for the page you are reading.</div>`;
    return;
  }
  items.forEach((bm) => {
    const row = document.createElement('div');
    row.className = 'side-item';
    row.innerHTML = `${icon('bookmark')}<span class="si-text truncate">${escapeHtml(bm.label)}</span>
      <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove bookmark">${icon('x', 'icon-sm')}</button>`;
    row.querySelector('span').addEventListener('click', () => S.viewer?.goToPage(bm.page));
    row.querySelector('button').addEventListener('click', () => S.bookmarks.remove(bm.id));
    list.append(row);
  });
}

function renderAnnotList() {
  const host = document.getElementById('panel-annotations');
  const items = S.annots?.items || [];
  const byPage = new Map();
  items.forEach((a) => { if (!byPage.has(a.page)) byPage.set(a.page, []); byPage.get(a.page).push(a); });
  host.innerHTML = `
    <div class="row-between" style="margin-bottom:8px">
      <span class="small muted">${items.length} annotation${items.length === 1 ? '' : 's'}</span>
      <button class="btn btn-ghost btn-sm" id="ann-export">${icon('save', 'icon-sm')}Export</button>
    </div>
    <div class="side-list" id="ann-list"></div>`;
  host.querySelector('#ann-export').addEventListener('click', exportAnnotatedPdf);
  const list = host.querySelector('#ann-list');
  if (!items.length) {
    list.innerHTML = `<div class="sidebar-empty">No annotations yet. Open the highlighter in the toolbar to start marking up this document.</div>`;
    return;
  }
  Array.from(byPage.keys()).sort((a, b) => a - b).forEach((page) => {
    const group = document.createElement('div');
    group.innerHTML = `<div class="section-label" style="margin:10px 0 4px">Page ${page}</div>`;
    byPage.get(page).forEach((a) => {
      const row = document.createElement('div');
      row.className = 'side-item';
      const label = a.type === 'text' || a.type === 'note' ? (a.text || '').slice(0, 40) : a.type;
      row.innerHTML = `<span class="annot-color-dot" style="background:${a.color || '#f2c744'}"></span>
        <span class="si-text truncate">${escapeHtml(label)}</span>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete annotation">${icon('trash', 'icon-sm')}</button>`;
      row.querySelector('.si-text').addEventListener('click', () => {
        S.viewer?.goToPage(page);
        S.annots.select(a.id);
      });
      row.querySelector('button').addEventListener('click', () => {
        S.annots.select(a.id);
        S.annots.deleteSelected();
      });
      group.append(row);
    });
    list.append(group);
  });
}

function renderInfo() {
  const host = document.getElementById('panel-info');
  if (!S.info) { host.innerHTML = `<div class="sidebar-empty">Open a document to see its properties.</div>`; return; }
  const rows = [
    ['Pages', S.info.pages],
    ['Title', S.info.title || '—'],
    ['Author', S.info.author || '—'],
    ['Subject', S.info.subject || '—'],
    ['Creator', S.info.creator || '—'],
    ['Producer', S.info.producer || '—'],
    ['Created', S.info.creationDate || '—'],
    ['Modified', S.info.modDate || '—'],
    ['Page size', S.info.firstPageSize ? `${S.info.firstPageSize.width} × ${S.info.firstPageSize.height} pt` : '—'],
    ['Annotations', S.annots ? `${S.annots.items.length} in viewer` : '0']
  ];
  host.innerHTML = `<dl class="info-rows">${rows.map(([k, v]) =>
    `<div class="info-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('')}</dl>
    <p class="hint" style="margin-top:10px">Metadata is read from the file itself. Some producers leave fields blank.</p>`;
}

/* ---------------- Actions ---------------- */
let annotBarBuilt = false;
function ensureAnnotBar() {
  if (annotBarBuilt) return;
  annotBarBuilt = true;
  buildAnnotBar();
}

function closeMenus() {
  document.querySelectorAll('.menu[data-open="true"]').forEach((m) => {
    m.dataset.open = 'false';
    m.parentElement?.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false');
  });
}

function toggleAnnotations() {
  ensureAnnotBar();
  closeMenus();
  const open = els.annotBar.dataset.open === 'true';
  els.annotBar.dataset.open = open ? 'false' : 'true';
  S.toolbar.setAnnotPressed(!open);
  if (!open) setTool('select');
  requestAnimationFrame(() => S.annots?.renderAll());
}

async function clearPageAnnotations() {
  if (!S.annots || !S.viewer) return;
  const page = S.viewer.current;
  if (!S.annots.countFor(page)) { toast('No annotations on this page.', { duration: 1600 }); return; }
  const ok = await confirmDialog({
    title: `Clear page ${page}?`,
    message: 'This removes every annotation on the current page. Other pages keep theirs. You can undo with the undo button until you leave the document.',
    confirmLabel: 'Clear page',
    danger: true
  });
  if (!ok) return;
  S.annots.clearPage(page);
  renderAnnotList();
}

async function downloadOriginal() {
  if (!S.doc) return;
  try {
    let blob = S.blob;
    if (!blob && S.source?.kind === 'url') {
      toast('Downloading the original file…', { duration: 1800 });
      const res = await fetch(S.source.url, { mode: 'cors' });
      if (!res.ok) throw new Error(`The server returned ${res.status}.`);
      blob = await res.blob();
      S.blob = blob;
    }
    if (!blob) throw new Error('This document has no local copy to download.');
    downloadBlob(blob, sanitizeFilename(S.docName || 'document.pdf'));
    toast('Download started', { type: 'success', duration: 2000 });
  } catch (e) {
    toast('Could not download the original: ' + e.message, { type: 'error' });
  }
}

async function copyPageText() {
  if (!S.doc || !S.viewer) return;
  try {
    const page = await S.doc.getPage(S.viewer.current);
    const text = await pageText(page);
    page.cleanup();
    if (!text) { toast('This page has no extractable text (it may be a scan).', { type: 'warn' }); return; }
    const ok = await copyText(text);
    toast(ok ? `Copied text from page ${S.viewer.current}` : 'Copy was blocked by the browser.', { type: ok ? 'success' : 'error', duration: 2200 });
  } catch (e) { toast('Could not read the page text: ' + e.message, { type: 'error' }); }
}

async function exportText() {
  if (!S.doc) return;
  const total = S.doc.numPages;
  const stop = toast('Extracting text…', { duration: 0 });
  try {
    const pages = await documentText(S.doc, {
      onProgress: (i, t) => { if (i % 10 === 0) toast(`Extracting text… ${i}/${t}`, { duration: 900 }); }
    });
    const text = pages.map((t, i) => `===== Page ${i + 1} =====\n${t || '(no text layer)'}`).join('\n\n');
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), (S.docName || 'document').replace(/\.pdf$/i, '') + '.txt');
    stop.close();
    toast(`Extracted ${total} pages`, { type: 'success' });
  } catch (e) {
    stop.close();
    toast('Text extraction failed: ' + e.message, { type: 'error' });
  }
}

async function savePageImage() {
  if (!S.doc || !S.viewer) return;
  try {
    const page = await S.doc.getPage(S.viewer.current);
    const canvas = await renderPageOffscreen(page, { scale: 2, maxPixels: 12_000_000 });
    const blob = await canvasToBlob(canvas, 'image/png');
    downloadBlob(blob, `${(S.docName || 'page').replace(/\.pdf$/i, '')}-page-${S.viewer.current}.png`);
    toast('Page image saved', { type: 'success' });
  } catch (e) { toast('Could not render the page: ' + e.message, { type: 'error' }); }
}

async function exportAnnotatedPdf() {
  if (!S.doc) return;
  await loadPdfLib().catch(() => {});
  if (!window.PDFLib) { toast('pdf-lib failed to load, so export is unavailable.', { type: 'error' }); return; }
  const stop = toast('Building a new PDF with your annotations…', { duration: 0 });
  try {
    const bytes = await sourceBytes();
    const pdfDoc = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const result = S.annots ? await S.annots.exportToPdf(pdfDoc) : { written: 0, skipped: 0 };
    const out = await pdfDoc.save();
    downloadBlob(new Blob([out], { type: 'application/pdf' }), pdfName(S.docName || 'document', '-annotated'));
    stop.close();
    if (result.written) toast(`${result.written} annotation${result.written === 1 ? '' : 's'} written into the PDF`, { type: 'success' });
    else toast('The PDF was saved. There were no annotations to write.', { type: 'info' });
    if (result.skipped) toast(`${result.skipped} annotation${result.skipped === 1 ? '' : 's'} could not be converted (unsupported content)`, { type: 'warn', duration: 6000 });
  } catch (e) {
    stop.close();
    toast('Export failed: ' + e.message, { type: 'error', duration: 7000 });
  }
}

async function sourceBytes() {
  if (S.blob) return new Uint8Array(await S.blob.arrayBuffer());
  if (S.source?.kind === 'url') {
    const res = await fetch(S.source.url, { mode: 'cors' });
    if (!res.ok) throw new Error(`Could not fetch the original PDF (HTTP ${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error('The original file is not available.');
}

async function exportPageRange() {
  if (!S.doc) return;
  const total = S.doc.numPages;
  const input = document.createElement('div');
  input.innerHTML = `<div class="field">
      <label class="label" for="range">Pages to export</label>
      <input class="input" id="range" value="1-${Math.min(total, 5)}" placeholder="1-3, 7, 10-12">
      <span class="hint">Use commas and ranges. Total pages: ${total}.</span>
    </div>
    <label class="checkbox" style="margin-top:12px"><input type="checkbox" id="with-annots" checked> Include viewer annotations</label>`;
  const ok = await dialog({
    title: 'Export pages',
    sub: 'Creates a new PDF containing only the pages you list.',
    body: input,
    actions: [
      { label: 'Cancel', value: false, variant: 'ghost' },
      { label: 'Export', value: true, variant: 'primary' }
    ]
  });
  if (!ok) return;
  const spec = input.querySelector('#range').value;
  const withAnnots = input.querySelector('#with-annots').checked;
  const pages = parsePageSpec(spec, total);
  if (!pages.length) { toast('That page range did not match any pages.', { type: 'error' }); return; }
  try {
    const bytes = await sourceBytes();
    const src = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const out = await window.PDFLib.PDFDocument.create();
    const copied = await out.copyPages(src, pages.map((p) => p - 1));
    copied.forEach((p) => out.addPage(p));
    if (withAnnots && S.annots) {
      // Only annotations on the exported pages are meaningful; shift them to the new index.
      const subset = new AnnotationManager({ viewer: S.viewer });
      subset.items = S.annots.items.filter((a) => pages.includes(a.page))
        .map((a) => ({ ...a, page: pages.indexOf(a.page) + 1 }));
      await subset.exportToPdf(out);
    }
    const data = await out.save();
    downloadBlob(new Blob([data], { type: 'application/pdf' }), pdfName(S.docName || 'document', '-pages'));
    toast(`Exported ${pages.length} page${pages.length === 1 ? '' : 's'}`, { type: 'success' });
  } catch (e) {
    toast('Export failed: ' + e.message, { type: 'error', duration: 6000 });
  }
}

function parsePageSpec(spec, total) {
  const set = new Set();
  String(spec || '').split(',').forEach((part) => {
    const bit = part.trim();
    if (!bit) return;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(bit);
    if (m) {
      const a = Math.max(1, Number(m[1])), b = Math.min(total, Number(m[2]));
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
    } else if (/^\d+$/.test(bit)) {
      const n = Number(bit);
      if (n >= 1 && n <= total) set.add(n);
    }
  });
  return Array.from(set).sort((a, b) => a - b);
}

async function printDocument() {
  if (!S.doc) return;
  const total = S.doc.numPages;
  // Open the print window inside the click, before any await: a window opened after an
  // await is blocked on phones (and on iOS the whole gesture is lost).
  const win = window.open('', '_blank');
  if (!win) {
    toast('Your browser blocked the print window. Allow pop-ups for this site, or use Download instead.', { type: 'error', duration: 6000 });
    return;
  }
  win.document.write('<title>Preparing print…</title><p style="font:16px system-ui;padding:24px">Preparing pages for print…</p>');
  if (total > 60) {
    const ok = await confirmDialog({
      title: `Print ${total} pages?`,
      message: 'Printing renders every page on this device, which can take a while and use a lot of memory on low-end hardware. Continue?',
      confirmLabel: 'Render and print'
    });
    if (!ok) { try { win.close(); } catch { /* ignore */ } return; }
  }
  const stop = toast('Preparing pages for print…', { duration: 0 });
  try {
    const images = [];
    for (let i = 1; i <= total; i++) {
      const page = await S.doc.getPage(i);
      const canvas = await renderPageOffscreen(page, { scale: 1.6, maxPixels: 6_000_000 });
      images.push(canvas.toDataURL('image/jpeg', 0.85));
      if (i % 5 === 0) toast(`Preparing print… ${i}/${total}`, { duration: 700 });
    }
    win.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(S.docName)}</title>
      <style>
        @page { margin: 0; }
        body { margin: 0; background: #fff; }
        img { display: block; width: 100%; page-break-after: always; break-after: page; }
        img:last-child { page-break-after: auto; }
      </style></head><body>${images.map((src) => `<img src="${src}" alt="">`).join('')}</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
    stop.close();
  } catch (e) {
    stop.close();
    toast('Print preparation failed: ' + e.message, { type: 'error' });
  }
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await els.app.requestFullscreen?.();
      S.toolbar.setFullscreen(true);
    } else {
      await document.exitFullscreen?.();
      S.toolbar.setFullscreen(false);
    }
  } catch {
    toast('Fullscreen was blocked by the browser.', { type: 'warn' });
  }
}

async function showInfoDialog() {
  if (!S.info) return;
  const rows = [
    ['Pages', S.info.pages], ['Title', S.info.title], ['Author', S.info.author], ['Subject', S.info.subject],
    ['Keywords', S.info.keywords], ['Creator', S.info.creator], ['Producer', S.info.producer],
    ['Created', S.info.creationDate], ['Modified', S.info.modDate],
    ['First page', `${S.info.firstPageSize?.width} × ${S.info.firstPageSize?.height} pt`],
    ['Fingerprint', S.info.fingerprints?.[0] || '—']
  ].filter(([, v]) => v !== '' && v !== undefined);
  await dialog({
    title: 'Document properties',
    sub: S.docName,
    body: `<dl class="info-rows">${rows.map(([k, v]) => `<div class="info-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('')}</dl>`,
    actions: [{ label: 'Close', value: true, variant: 'primary' }]
  });
}

async function saveToLibrary() {
  if (!S.doc) return;
  try {
    if (S.source?.kind === 'library') { toast('This document is already in your library.', { duration: 2200 }); return; }
    let blob = S.blob;
    if (!blob && S.source?.kind === 'url') {
      const res = await fetch(S.source.url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    }
    if (!blob) throw new Error('No local copy is available.');
    const rec = await saveDocument({ name: S.docName, blob, pageCount: S.doc.numPages, size: blob.size });
    S.docKey = rec.id;
    S.source = { kind: 'library', id: rec.id };
    if (S.annots) saveAnnotations(rec.id, S.annots.items).catch(() => {});
    toast('Saved to your local library. It opens offline.', { type: 'success' });
  } catch (e) {
    toast('Could not save locally: ' + e.message, { type: 'error' });
  }
}

async function promptOpenUrl() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="field">
      <label class="label" for="open-url">PDF address</label>
      <input class="input" id="open-url" type="url" placeholder="https://example.com/document.pdf" spellcheck="false">
      <span class="hint">The server must allow cross-origin reads (CORS). <a href="docs.html#cors">Details</a></span>
    </div>`;
  const ok = await dialog({
    title: 'Open a PDF from a link',
    body,
    actions: [
      { label: 'Cancel', value: false, variant: 'ghost' },
      { label: 'Open', value: true, variant: 'primary', onClick: (dlg) => !!dlg.querySelector('#open-url').value.trim() }
    ],
    onMount: (dlg) => {
      dlg.querySelector('#open-url').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); dlg.querySelector('.modal-foot .btn-primary').click(); }
      });
    }
  });
  if (!ok) return;
  const value = body.querySelector('#open-url').value;
  const url = normalizeUrl(value);
  if (!url) { toast('That is not a valid http(s) link.', { type: 'error' }); return; }
  history.replaceState(null, '', `viewer.html?file=${encodeURIComponent(url)}`);
  await openRemote(url);
}

/* ---------------- Signature + image placement ---------------- */
async function drawSignature() {
  const { openSignatureLibrary } = await loadFeature('../viewer/signatures.js');
  openSignatureLibrary({
    onPick: (sig) => {
      if (!S.annots) return;
      S.annots.pendingImage = { src: sig.dataUrl, width: sig.width, height: sig.height };
      useTool('signature');
      toast('Now click on the page to place your signature', { duration: 3200 });
    }
  });
}

function pickImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        if (S.annots) {
          S.annots.pendingImage = { src: reader.result, width: img.width, height: img.height };
          setTool('image');
          toast('Click on the page to place the image', { duration: 3000 });
        }
      };
      img.onerror = () => toast('That image could not be decoded.', { type: 'error' });
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

/* ---------------- Keyboard ---------------- */
function bindKeys() {
  S.keys?.destroy();
  S.keys = new KeyController({
    next: () => S.viewer?.nextPage(),
    prev: () => S.viewer?.prevPage(),
    first: () => S.viewer?.firstPage(),
    last: () => S.viewer?.lastPage(),
    search: () => focusSearch(),
    print: () => printDocument(),
    save: () => downloadOriginal(),
    zoomIn: () => S.viewer?.zoomIn().then(syncZoom),
    zoomOut: () => S.viewer?.zoomOut().then(syncZoom),
    fitWidth: () => S.viewer?.fitWidth().then(syncZoom),
    fitPage: () => S.viewer?.fitPage().then(syncZoom),
    sidebar: () => toggleSidebar(),
    fullscreen: () => toggleFullscreen(),
    rotate: () => S.viewer?.rotate(90),
    pan: () => togglePan(),
    toolSelect: () => useTool('select'),
    toolHighlight: () => useTool('highlight'),
    toolUnderline: () => useTool('underline'),
    toolStrike: () => useTool('strike'),
    toolPen: () => useTool('pen'),
    toolMarker: () => useTool('marker'),
    toolEraser: () => useTool('eraser'),
    toolText: () => useTool('text'),
    toolNote: () => useTool('note'),
    toolRect: () => useTool('rect'),
    toolEllipse: () => useTool('ellipse'),
    toolArrow: () => useTool('arrow'),
    toolLine: () => useTool('line'),
    toolImage: () => pickImage(),
    toolSignature: () => drawSignature(),
    duplicate: () => S.annots?.duplicateSelected(),
    deleteSelected: () => S.annots?.deleteSelected(),
    zen: () => setZen(els.app.dataset.zen !== 'true'),
    escape: () => {
      if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
      if (els.app.dataset.zen === 'true') { setZen(false); return; }
      if (els.annotBar.dataset.open === 'true') { toggleAnnotations(); return; }
      if (S.toolbar?.refs.searchBox?.dataset.open === 'true') { S.toolbar.closeSearch(); return; }
      if (S.annots?.selectedId) S.annots.select(null);
    }
  }, { enabled: store.get('shortcutsEnabled') !== false }).attach();
}

/* ---------------- Global file drop ---------------- */
function wireGlobalDrop() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    depth++;
    els.drop.dataset.active = 'true';
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) els.drop.dataset.active = 'false';
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    els.drop.dataset.active = 'false';
    const file = Array.from(e.dataTransfer?.files || [])[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast('Only PDF files can be opened here.', { type: 'warn' });
      return;
    }
    await openLocalFileInViewer(file);
  });
  els.fileInput.addEventListener('change', async () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = '';
    if (file) await openLocalFileInViewer(file);
  });
}

async function openLocalFileInViewer(file) {
  try {
    showLoading(file.name);
    S.docName = file.name;
    S.blob = file;
    S.docKey = 'file:' + file.name + ':' + file.size + ':' + (file.lastModified || 0);
    S.source = { kind: 'file' };
    const doc = await openFromFile(file);
    await onDocumentReady(doc, { name: file.name, size: file.size });
  } catch (err) {
    showError(enrichError(err), { retry: () => openLocalFileInViewer(file) });
  }
}

/* ---------------- Helpers ---------------- */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.sidebar?.dataset.open === 'true') closeSidebarMobile();
});

main().catch((e) => {
  console.error(e);
  const card = document.getElementById('status-card');
  if (card) card.innerHTML = `<h2>The viewer failed to start</h2><p>${escapeHtml(e.message)}</p>`;
});
