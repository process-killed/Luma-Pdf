/**
 * Viewer toolbar — built in JS so the embed endpoint can request a reduced set of controls.
 */
import { icon } from '../ui/icons.js';
import { ZOOM_STEPS } from '../config.js';

const MODES = [
  { id: 'vertical', label: 'Continuous', icon: 'list' },
  { id: 'single', label: 'Single page', icon: 'file' },
  { id: 'horizontal', label: 'Horizontal', icon: 'columns' },
  { id: 'spread', label: 'Two-page spread', icon: 'columns' },
  { id: 'book', label: 'Book mode', icon: 'book-open' }
];

export class Toolbar {
  /**
   * @param {HTMLElement} host
   * @param {object} opts feature flags + callbacks
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = {
      sidebar: true, search: true, download: true, print: true, fullscreen: true,
      annotations: true, navigation: true, title: true, minimal: false, moreMenu: true,
      pan: false, forms: false,
      ...opts
    };
    this.refs = {};
  }

  mount() {
    const o = this.opts;
    this.host.className = 'viewer-toolbar';
    this.host.innerHTML = `
      <a class="tb-btn tb-home" href="index.html" aria-label="Luma PDF home" title="Home">${icon('home')}</a>
      ${o.sidebar ? `<button class="tb-btn" data-act="sidebar" aria-label="Toggle sidebar" title="Sidebar (Ctrl+B)" aria-pressed="true">${icon('sidebar')}</button>` : ''}
      ${o.pan ? `<button class="tb-btn tb-collapse" data-act="pan" aria-label="Hand tool — drag to move the page" title="Hand tool (H) · or hold Space" aria-pressed="false">${icon('move')}</button>` : ''}
      ${o.forms ? `<button class="tb-btn" data-act="forms" aria-label="Fill form fields" title="Fill form fields" aria-pressed="false" hidden>${icon('edit')}</button>` : ''}
      ${o.title ? `<div class="tb-title">
        <span class="doc-name" data-ref="docName">No document</span>
        <span class="doc-meta" data-ref="docMeta"></span>
      </div>` : ''}
      <span class="tb-sep tb-hide-mobile"></span>
      ${o.navigation ? `<div class="tb-group" data-ref="navGroup">
        <button class="tb-btn" data-act="prev" aria-label="Previous page" title="Previous page">${icon('chevron-left')}</button>
        <div class="tb-page">
          <input class="input" data-ref="pageInput" type="text" inputmode="numeric" value="1" aria-label="Page number">
          <span class="page-total">/ <span data-ref="pageTotal">0</span></span>
        </div>
        <button class="tb-btn" data-act="next" aria-label="Next page" title="Next page">${icon('chevron-right')}</button>
      </div>` : ''}
      <div class="tb-spacer"></div>
      ${o.search ? `<div class="tb-search" data-ref="searchBox">
        <input class="input" data-ref="searchInput" type="search" placeholder="Search document" aria-label="Search document" autocomplete="off">
        <span class="search-count" data-ref="searchCount"></span>
        <button class="tb-btn" data-act="search-prev" aria-label="Previous match" title="Previous match (Shift+Enter)">${icon('chevron-up')}</button>
        <button class="tb-btn" data-act="search-next" aria-label="Next match" title="Next match (Enter)">${icon('chevron-down')}</button>
        <button class="tb-btn" data-act="search-close" aria-label="Close search">${icon('x')}</button>
      </div>
      <button class="tb-btn" data-act="search-open" aria-label="Search document" title="Search (Ctrl+F)">${icon('search')}</button>` : ''}
      <div class="tb-group tb-zoom">
        <button class="tb-btn tb-hide-mobile" data-act="zoom-out" aria-label="Zoom out" title="Zoom out">${icon('minus')}</button>
        <button class="zoom-value" data-act="zoom-menu" aria-haspopup="true" data-ref="zoomValue" title="Zoom level">100%</button>
        <button class="tb-btn tb-hide-mobile" data-act="zoom-in" aria-label="Zoom in" title="Zoom in">${icon('plus')}</button>
      </div>
      <div class="menu-host">
        <button class="tb-btn tb-collapse" data-menu-trigger data-act="view-menu" aria-label="View options" aria-expanded="false" title="View options">${icon('grid')}</button>
        <div class="menu" data-ref="viewMenu">
          <div class="menu-label">Page layout</div>
          ${MODES.map((m) => `<button class="menu-item" data-mode="${m.id}" role="menuitemradio" aria-checked="false">
            ${icon(m.icon)}<span>${m.label}</span><span class="mi-check">${icon('check', 'icon-sm')}</span></button>`).join('')}
          <div class="menu-sep"></div>
          <div class="menu-label">Fit</div>
          <button class="menu-item" data-fit="page-width">${icon('fit-width')}<span>Fit width</span></button>
          <button class="menu-item" data-fit="page-fit">${icon('fit-page')}<span>Fit page</span></button>
          <button class="menu-item" data-fit="actual">${icon('actual-size')}<span>Actual size</span></button>
          <div class="menu-sep"></div>
          <button class="menu-item" data-act="rotate">${icon('rotate-cw')}<span>Rotate view</span></button>
          <button class="menu-item" data-act="direction">${icon('arrow-right')}<span>Toggle reading direction</span></button>
          <div class="menu-sep"></div>
          <div class="menu-label">Background</div>
          ${['light', 'sepia', 'slate', 'dark', 'paper'].map((bg) => `<button class="menu-item" data-bg="${bg}"><span class="annot-color-dot" style="background:${bgColor(bg)}"></span><span>${bg[0].toUpperCase() + bg.slice(1)}</span></button>`).join('')}
        </div>
      </div>
      ${o.annotations ? `<button class="tb-btn tb-collapse" data-act="annotations" aria-label="Annotation tools" title="Annotate" aria-pressed="false">${icon('highlighter')}</button>` : ''}
      <div class="tb-group">
        <button class="tb-btn tb-collapse" data-act="zen" aria-label="Distraction-free mode" title="Distraction-free (Z)">${icon('eye')}</button>
        ${o.print ? `<button class="tb-btn tb-collapse" data-act="print" aria-label="Print" title="Print (Ctrl+P)">${icon('printer')}</button>` : ''}
        ${o.download ? `<button class="tb-btn tb-collapse" data-act="download" aria-label="Download" title="Download (Ctrl+S)">${icon('download')}</button>` : ''}
        ${o.fullscreen ? `<button class="tb-btn tb-collapse" data-act="fullscreen" aria-label="Fullscreen" title="Fullscreen">${icon('maximize')}</button>` : ''}
      </div>
      ${o.moreMenu === false ? '' : `<div class="menu-host">
        <button class="tb-btn" data-menu-trigger aria-label="More actions" aria-expanded="false" title="More">${icon('more-vertical')}</button>
        <div class="menu" data-ref="moreMenu">
          <div class="menu-label">View</div>
          ${MODES.map((m) => `<button class="menu-item" data-mode="${m.id}" role="menuitemradio" aria-checked="false">
            ${icon(m.icon)}<span>${m.label}</span><span class="mi-check">${icon('check', 'icon-sm')}</span></button>`).join('')}
          <div class="menu-sep"></div>
          <button class="menu-item" data-fit="page-width">${icon('fit-width')}<span>Fit width</span></button>
          <button class="menu-item" data-fit="page-fit">${icon('fit-page')}<span>Fit page</span></button>
          <button class="menu-item" data-fit="actual">${icon('actual-size')}<span>Actual size</span></button>
          <button class="menu-item" data-act="rotate">${icon('rotate-cw')}<span>Rotate view</span></button>
          <button class="menu-item" data-act="direction">${icon('arrow-right')}<span>Toggle reading direction</span></button>
          <button class="menu-item" data-act="zen">${icon('eye')}<span>Distraction-free mode</span></button>
          <div class="menu-sep"></div>
          <button class="menu-item" data-act="search-open">${icon('search')}<span>Find in document</span></button>
          ${o.download ? `<button class="menu-item" data-act="download">${icon('download')}<span>Download a copy</span></button>` : ''}
          ${o.print ? `<button class="menu-item" data-act="print">${icon('printer')}<span>Print</span></button>` : ''}
          ${o.fullscreen ? `<button class="menu-item" data-act="fullscreen">${icon('maximize')}<span>Fullscreen</span></button>` : ''}
          <div class="menu-sep"></div>
          <button class="menu-item" data-act="open-file">${icon('upload')}<span>Open another PDF…</span></button>
          <button class="menu-item" data-act="open-url">${icon('link')}<span>Open a PDF link…</span></button>
          <div class="menu-sep"></div>
          <button class="menu-item" data-act="copy-text">${icon('clipboard')}<span>Copy page text</span></button>
          <button class="menu-item" data-act="export-text">${icon('file-text')}<span>Extract all text…</span></button>
          <button class="menu-item" data-act="screenshot">${icon('image')}<span>Save page as image</span></button>
          <div class="menu-sep"></div>
          <button class="menu-item" data-act="export-pdf">${icon('save')}<span>Save annotated copy</span></button>
          <button class="menu-item" data-act="export-pages">${icon('layers')}<span>Export selected pages…</span></button>
          <div class="menu-sep"></div>
          <button class="menu-item" data-act="info">${icon('info')}<span>Document properties</span></button>
          <button class="menu-item" data-act="library">${icon('folder')}<span>Save to library</span></button>
          <a class="menu-item" href="settings.html">${icon('settings')}<span>Viewer settings</span></a>
          <a class="menu-item" href="index.html">${icon('globe')}<span>Luma PDF home</span></a>
        </div>
      </div>`}`;

    this.refs.docName = this.host.querySelector('[data-ref="docName"]');
    this.refs.docMeta = this.host.querySelector('[data-ref="docMeta"]');
    this.refs.pageInput = this.host.querySelector('[data-ref="pageInput"]');
    this.refs.pageTotal = this.host.querySelector('[data-ref="pageTotal"]');
    this.refs.zoomValue = this.host.querySelector('[data-ref="zoomValue"]');
    this.refs.searchBox = this.host.querySelector('[data-ref="searchBox"]');
    this.refs.searchInput = this.host.querySelector('[data-ref="searchInput"]');
    this.refs.searchCount = this.host.querySelector('[data-ref="searchCount"]');
    this.refs.viewMenu = this.host.querySelector('[data-ref="viewMenu"]');
    this.bind();
    return this;
  }

  bind() {
    const o = this.opts;
    const click = (act, fn) => {
      this.host.querySelectorAll(`[data-act="${act}"]`).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); fn(e, b); }));
    };

    click('sidebar', () => o.onSidebar?.());
    click('pan', () => o.onPan?.());
    click('forms', () => o.onForms?.());
    click('prev', () => o.onPrev?.());
    click('next', () => o.onNext?.());
    click('zoom-in', () => o.onZoomIn?.());
    click('zoom-out', () => o.onZoomOut?.());
    click('zoom-menu', (e, btn) => this.openZoomMenu(btn));
    click('search-open', () => this.openSearch());
    click('search-close', () => this.closeSearch());
    click('search-next', () => o.onSearchNext?.());
    click('search-prev', () => o.onSearchPrev?.());
    click('annotations', () => o.onAnnotate?.());
    click('download', () => o.onDownload?.());
    click('print', () => o.onPrint?.());
    click('fullscreen', () => o.onFullscreen?.());
    click('zen', () => o.onZen?.());
    click('rotate', () => o.onRotate?.());
    click('direction', () => o.onDirection?.());
    click('open-file', () => o.onOpenFile?.());
    click('open-url', () => o.onOpenUrl?.());
    click('copy-text', () => o.onCopyText?.());
    click('export-text', () => o.onExportText?.());
    click('screenshot', () => o.onScreenshot?.());
    click('export-pdf', () => o.onExportPdf?.());
    click('export-pages', () => o.onExportPages?.());
    click('info', () => o.onInfo?.());
    click('library', () => o.onSaveToLibrary?.());

    this.host.querySelectorAll('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => o.onMode?.(b.dataset.mode));
    });
    this.host.querySelectorAll('[data-fit]').forEach((b) => {
      b.addEventListener('click', () => o.onFit?.(b.dataset.fit));
    });
    this.host.querySelectorAll('[data-bg]').forEach((b) => {
      b.addEventListener('click', () => o.onBackground?.(b.dataset.bg));
    });

    this.refs.pageInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const n = Number.parseInt(this.refs.pageInput.value, 10);
        if (Number.isFinite(n)) o.onGoTo?.(n);
        this.refs.pageInput.blur();
      }
    });
    this.refs.pageInput?.addEventListener('focus', () => this.refs.pageInput.select());

    this.refs.searchInput?.addEventListener('input', (e) => o.onSearch?.(e.target.value));
    this.refs.searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) o.onSearchPrev?.();
        else o.onSearchNext?.();
      }
      if (e.key === 'Escape') this.closeSearch();
    });
  }

  openZoomMenu(btn) {
    const existing = this.host.querySelector('.zoom-menu-pop');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.className = 'menu zoom-menu-pop';
    menu.dataset.open = 'true';
    menu.style.top = 'calc(100% + 4px)';
    menu.innerHTML = `
      <button class="menu-item" data-z="page-width">${icon('fit-width')}<span>Fit width</span></button>
      <button class="menu-item" data-z="page-fit">${icon('fit-page')}<span>Fit page</span></button>
      <button class="menu-item" data-z="actual">${icon('actual-size')}<span>Actual size</span></button>
      <div class="menu-sep"></div>
      ${ZOOM_STEPS.map((z) => `<button class="menu-item" data-z="${z}"><span style="width:15px"></span><span>${z}%</span></button>`).join('')}`;
    btn.closest('.menu-host') || btn.parentElement;
    btn.parentElement.style.position = 'relative';
    btn.parentElement.append(menu);
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-z]');
      if (item) {
        this.opts.onZoom?.(item.dataset.z);
        menu.remove();
      }
    });
    setTimeout(() => document.addEventListener('click', function off(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', off); }
    }), 0);
  }

  openSearch() {
    if (!this.refs.searchBox) return;
    this.refs.searchBox.dataset.open = 'true';
    this.refs.searchInput?.focus();
    this.refs.searchInput?.select();
    this.opts.onSearchOpen?.();
  }

  closeSearch() {
    if (!this.refs.searchBox) return;
    this.refs.searchBox.dataset.open = 'false';
    this.opts.onSearchClose?.();
  }

  setDocument(name, meta = '') {
    if (this.refs.docName) this.refs.docName.textContent = name || 'Untitled document';
    if (this.refs.docMeta) this.refs.docMeta.textContent = meta;
    document.title = name ? `${name} — Luma PDF` : 'Luma PDF';
  }

  setPage(page, total) {
    if (this.refs.pageInput && document.activeElement !== this.refs.pageInput) this.refs.pageInput.value = String(page);
    if (this.refs.pageTotal) this.refs.pageTotal.textContent = String(total);
  }

  setZoom(percent) {
    if (this.refs.zoomValue) this.refs.zoomValue.textContent = `${percent}%`;
  }

  setMode(mode) {
    this.host.querySelectorAll('[data-mode]').forEach((b) => {
      b.setAttribute('aria-checked', b.dataset.mode === mode ? 'true' : 'false');
    });
  }

  setSearchCount(text) {
    if (this.refs.searchCount) this.refs.searchCount.textContent = text;
  }

  /** Reveal the form button once fields are known to exist. */
  showForms(count) {
    const btn = this.host.querySelector('[data-act="forms"]');
    if (!btn) return;
    btn.hidden = !count;
    btn.title = count ? `Fill form fields (${count})` : 'Fill form fields';
  }

  setFormsPressed(on) {
    this.host.querySelector('[data-act="forms"]')?.setAttribute('aria-pressed', String(on));
  }

  setPanPressed(on) {
    this.host.querySelector('[data-act="pan"]')?.setAttribute('aria-pressed', String(on));
  }

  setSidebarPressed(on) {
    this.host.querySelector('[data-act="sidebar"]')?.setAttribute('aria-pressed', String(on));
  }

  setAnnotPressed(on) {
    this.host.querySelector('[data-act="annotations"]')?.setAttribute('aria-pressed', String(on));
  }

  setFullscreen(on) {
    const btn = this.host.querySelector('[data-act="fullscreen"]');
    if (btn) {
      btn.innerHTML = icon(on ? 'minimize' : 'maximize');
      btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    }
  }
}

function bgColor(bg) {
  return { light: '#e9e9ee', sepia: '#efe6d4', slate: '#22252c', dark: '#08080b', paper: '#f6f4ef' }[bg] || '#e9e9ee';
}
