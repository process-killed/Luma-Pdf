/**
 * Viewer — layout, virtualised rendering, zoom and navigation for an open PDF.
 *
 * Performance design:
 *  - page geometry is measured once per layout change (not per scroll), so scrolling
 *    never forces a layout;
 *  - zooming stretches the existing bitmaps and re-renders the visible pages, so no
 *    page ever flashes blank;
 *  - rendering is queued and bounded by the active profile;
 *  - panning (drag), pinch-zoom and ctrl+wheel zoom are handled here, with no layout
 *    reads inside the gesture.
 */
import { PageView } from './renderer.js';
import { TaskQueue } from '../performance/memory-manager.js';
import { clamp, throttle, debounce } from '../utils/dom.js';
import { ZOOM_STEPS } from '../config.js';

const PAD_X = 16;

export class Viewer {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.workspace scroll container
   * @param {HTMLElement} opts.stack page container
   * @param {any} opts.doc PDF.js document proxy
   * @param {object} opts.profile performance profile config
   * @param {(type:string, detail?:any)=>void} [opts.onEvent]
   */
  constructor({ workspace, stack, doc, profile, onEvent, mode = 'vertical', zoom = 'page-width', direction = 'ltr', gap = 14, dpr }) {
    this.workspace = workspace;
    this.stack = stack;
    this.doc = doc;
    this.profile = profile;
    this.onEvent = onEvent || (() => {});
    this.mode = mode;
    this.zoomSpec = zoom;
    this.direction = direction;
    this.dpr = dpr || window.devicePixelRatio || 1;
    this.gap = gap;
    this.pages = [];
    this.metrics = [];
    this.scale = 1;
    this.rotation = 0;
    this.current = 1;
    this.visible = new Set();
    this.renderedOrder = [];
    this.queue = new TaskQueue(profile.maxConcurrentRenders || 2);
    this.destroyed = false;
    this.sizes = [];
    this.zooming = false;
    this.panMode = false;
    this.spaceHeld = false;
    this.panning = null;
    this.pointers = new Map();
    this.pinch = null;
    this.history = [1];
    this._zoomTimer = 0;
    this._metricsDirty = true;
    this._lastWindow = '';
  }

  async init({ startPage = 1, restoreScroll = null } = {}) {
    const t = (this.timings = {});
    let mark = performance.now();
    const lap = (name) => { const now = performance.now(); t[name] = Math.round(now - mark); mark = now; };
    await this.measureSizes();
    lap('measureFirstPage');
    this.buildPages();
    this.applyLayout();
    lap('buildLayout');
    this.computeScale();
    this.updateMetrics();
    lap('measureLayout');
    this.attachInteractions();
    this.stack.style.setProperty('--page-gap', `${this.gap}px`);
    if (startPage > 1) this.goToPage(startPage, { smooth: false, silent: true });
    // A cheap preview lands in a fraction of the time of a sharp render; the sharp
    // pass follows immediately after it, so the page is readable before it is perfect.
    this.requestRender(this.current, false, 'preview');
    this.renderVisible(true);
    lap('scheduleFirstRender');
    if (restoreScroll) {
      requestAnimationFrame(() => {
        this.workspace.scrollTop = restoreScroll;
        this.onScrollFrame(true);
      });
    }
    this.onEvent('ready', { pages: this.doc.numPages, scale: this.scale });
    return this;
  }

  /* ---------- Sizes ---------- */
  /**
   * Only page 1 is measured before the first paint. Every other page keeps that size
   * until it comes near the viewport, so opening a 500-page document costs one worker
   * call instead of five hundred.
   */
  async measureSizes() {
    const n = this.doc.numPages;
    let base = { width: 612, height: 792 };
    try {
      const first = await this.doc.getPage(1);
      const vp = first.getViewport({ scale: 1, rotation: 0 });
      base = { width: vp.width, height: vp.height };
    } catch { /* letter fallback */ }
    this.sizes = new Array(n).fill(base);
    this.sizesKnown = new Uint8Array(n);
    this.sizesKnown[0] = 1;
  }

  /** Measure the real size of pages in a window — parallel, once each. */
  async ensureSizesAround(first, last) {
    if (this.destroyed || !this.sizesKnown) return;
    const from = Math.max(1, first - 4);
    const to = Math.min(this.pages.length, last + 4);
    const pending = [];
    for (let i = from; i <= to; i++) {
      if (this.sizesKnown[i - 1]) continue;
      this.sizesKnown[i - 1] = 1;
      pending.push(this.doc.getPage(i).then((page) => {
        const vp = page.getViewport({ scale: 1, rotation: 0 });
        this.sizes[i - 1] = { width: vp.width, height: vp.height };
        const pv = this.pages[i - 1];
        if (pv && !pv.rendered) {
          pv.baseSize = this.sizes[i - 1];
          pv.applySize(this.scale);
        }
      }).catch(() => { /* keep the default */ }));
    }
    if (!pending.length) return;
    await Promise.all(pending);
    this._metricsDirty = true;
    if (!this.destroyed) this.updateMetrics();
  }

  buildPages() {
    this.pages = this.sizes.map((size, i) => new PageView(i + 1, size));
    this.stack.replaceChildren();
  }

  /* ---------- Layout ---------- */
  applyLayout() {
    const mode = this.mode;
    this.stack.dataset.mode = mode;
    this.workspace.dataset.mode = mode;
    this.stack.replaceChildren();

    if (mode === 'spread' || mode === 'book') {
      const rows = [];
      let i = 0;
      if (mode === 'book') { rows.push([this.pages[0]]); i = 1; }
      while (i < this.pages.length) { rows.push(this.pages.slice(i, i + 2)); i += 2; }
      for (const group of rows) {
        const row = document.createElement('div');
        row.className = 'spread-row';
        row.style.gap = `${Math.max(2, this.gap / 3)}px`;
        if (this.direction === 'rtl') row.style.flexDirection = 'row-reverse';
        group.forEach((pv) => row.append(pv.node || pv.createPlaceholder()));
        this.stack.append(row);
      }
    } else {
      this.pages.forEach((pv) => {
        this.stack.append(pv.node || pv.createPlaceholder());
      });
      if (this.direction === 'rtl' && mode === 'horizontal') this.stack.style.flexDirection = 'row-reverse';
      else this.stack.style.flexDirection = '';
    }

    if (mode === 'single') {
      this.pages.forEach((pv, idx) => {
        const node = pv.node;
        if (node) node.style.display = idx + 1 === this.current ? '' : 'none';
      });
    } else {
      this.pages.forEach((pv) => { const node = pv.node; if (node) node.style.display = ''; });
    }
    this._metricsDirty = true;
  }

  setMode(mode, { keepPage = true } = {}) {
    const target = this.current;
    this.mode = mode;
    this.pages.forEach((pv) => pv.release());
    this.renderedOrder = [];
    this.visible.clear();
    this.applyLayout();
    this.computeScale();
    this.updateMetrics();
    if (keepPage) this.goToPage(target, { smooth: false, silent: true });
    this.renderVisible(true);
    this.onEvent('modeChanged', { mode });
  }

  setDirection(dir) {
    this.direction = dir;
    const target = this.current;
    this.applyLayout();
    this.updateMetrics();
    this.goToPage(target, { smooth: false, silent: true });
    this.onEvent('modeChanged', { mode: this.mode, direction: dir });
  }

  setGap(gap) {
    this.gap = gap;
    this.stack.style.setProperty('--page-gap', `${gap}px`);
    this.stack.querySelectorAll('.spread-row').forEach((r) => { r.style.gap = `${Math.max(2, gap / 3)}px`; });
    this._metricsDirty = true;
  }

  /* ---------- Zoom ---------- */
  computeScale() {
    const wsW = this.workspace.clientWidth || 900;
    const wsH = this.workspace.clientHeight || 700;
    const pageW = this.sizes[this.current - 1]?.width || 612;
    const pageH = this.sizes[this.current - 1]?.height || 792;
    const spread = this.mode === 'spread' || this.mode === 'book';
    const usableW = Math.max(180, wsW - PAD_X * 2 - (spread ? this.gap + 6 : 0));
    const usableH = Math.max(180, wsH - 36);

    let scale;
    const spec = this.zoomSpec;
    if (spec === 'page-width' || spec === 'width') {
      scale = (spread ? usableW / 2 : usableW) / pageW;
    } else if (spec === 'page-fit' || spec === 'page') {
      scale = Math.min((spread ? usableW / 2 : usableW) / pageW, usableH / pageH);
    } else if (spec === 'actual') {
      scale = 1;
    } else {
      const pct = typeof spec === 'number' ? spec : Number.parseFloat(String(spec)) || 100;
      scale = pct / 100;
    }
    scale = clamp(scale, 0.1, 8);
    this.scale = scale;
    this.pages.forEach((pv) => pv.applySize(scale));
    return scale;
  }

  /**
   * Point under a client coordinate, expressed relative to the page beneath it.
   * Page-relative anchoring keeps the cursor pinned even though centring changes
   * when a zoomed page becomes wider than the viewport.
   */
  anchorAt({ clientX, clientY }) {
    const r = this.workspace.getBoundingClientRect();
    const contentX = this.workspace.scrollLeft + (clientX - r.left);
    const contentY = this.workspace.scrollTop + (clientY - r.top);
    this.ensureMetrics();
    let pageIndex = -1;
    for (let i = 0; i < this.metrics.length; i++) {
      const m = this.metrics[i];
      if (!m) continue;
      if (contentY >= m.top - 60 && contentY <= m.top + m.height + 60) { pageIndex = i; break; }
    }
    const m = pageIndex >= 0 ? this.metrics[pageIndex] : null;
    return {
      ox: clientX - r.left,
      oy: clientY - r.top,
      pageIndex,
      px: m ? (contentX - m.left) / this.scale : null,
      py: m ? (contentY - m.top) / this.scale : null,
      contentX,
      contentY
    };
  }

  restoreAnchor(anchor, prevScale) {
    const target = () => {
      this.updateMetrics();
      const m = anchor.pageIndex >= 0 ? this.metrics[anchor.pageIndex] : null;
      if (m && anchor.px !== null) {
        return {
          left: Math.max(0, m.left + anchor.px * this.scale - anchor.ox),
          top: Math.max(0, m.top + anchor.py * this.scale - anchor.oy)
        };
      }
      const k = this.scale / prevScale;
      return {
        left: Math.max(0, anchor.contentX * k - anchor.ox),
        top: Math.max(0, anchor.contentY * k - anchor.oy)
      };
    };

    const wanted = target();
    // Reading scrollWidth forces the browser to lay the newly sized pages out first,
    // otherwise the assignment below is clamped by the old, narrower scroll area.
    void this.stack.scrollWidth;
    this.workspace.scrollLeft = wanted.left;
    this.workspace.scrollTop = wanted.top;

    const appliedLeft = this.workspace.scrollLeft;
    const appliedTop = this.workspace.scrollTop;
    if (Math.abs(appliedLeft - wanted.left) > 1 || Math.abs(appliedTop - wanted.top) > 1) {
      requestAnimationFrame(() => {
        if (this.destroyed) return;
        const again = target();
        this.workspace.scrollLeft = again.left;
        this.workspace.scrollTop = again.top;
      });
    }
  }

  /**
   * @param {string|number} spec zoom spec or percent
   * @param {{at?:{clientX:number,clientY:number}, keepPage?:boolean}} opts
   */
  setZoom(spec, { at = null, keepPage = true } = {}) {
    const prevScale = this.scale;
    const anchor = at ? this.anchorAt(at) : null;
    this.zoomSpec = spec;
    this.zooming = true;
    this.computeScale();
    this.updateMetrics();

    if (anchor) {
      this.restoreAnchor(anchor, prevScale);
    } else if (keepPage) {
      this.goToPage(this.current, { smooth: false, silent: true });
    }

    this.renderVisible(true);
    this.onEvent('zoomChanged', { scale: this.scale, percent: Math.round(this.scale * 100) });
    this.scheduleSettle();
    return Promise.resolve(this.scale);
  }

  scheduleSettle() {
    clearTimeout(this._zoomTimer);
    this._zoomTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.zooming = false;
      this._metricsDirty = true;
      this.updateMetrics();
      this.renderVisible(false);
      this.buildTextLayers();
      this.pages.forEach((pv) => { if (pv.searchRects?.length) pv.redrawSearch(); });
      this.onEvent('zoomSettled', { scale: this.scale, percent: Math.round(this.scale * 100) });
    }, 180);
  }

  zoomIn() {
    const pct = Math.round(this.scale * 100);
    const next = ZOOM_STEPS.find((s) => s > pct + 1) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
    return this.setZoom(next);
  }

  zoomOut() {
    const pct = Math.round(this.scale * 100);
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < pct - 1) || ZOOM_STEPS[0];
    return this.setZoom(prev);
  }

  fitWidth() { return this.setZoom('page-width'); }
  fitPage() { return this.setZoom('page-fit'); }
  actualSize() { return this.setZoom('actual'); }

  /* ---------- Rotation ---------- */
  rotate(delta = 90) {
    this.rotation = (this.rotation + delta + 360) % 360;
    const target = this.current;
    this.pages.forEach((pv) => { pv.rotation = this.rotation; pv.release(); pv.page = null; });
    this.renderedOrder = [];
    this.visible.clear();
    this.measureSizes().then(() => {
      this.pages.forEach((pv, i) => { pv.baseSize = this.sizes[i] || pv.baseSize; });
      this.computeScale();
      this.updateMetrics();
      this.goToPage(target, { smooth: false, silent: true });
      this.renderVisible(true);
      this.onEvent('rotationChanged', { rotation: this.rotation });
    });
  }

  /* ---------- Geometry cache ---------- */
  /**
   * Read every page's position once. Called after layout/zoom/resize only — never
   * during a scroll, which is what kept scrolling smooth.
   */
  updateMetrics() {
    const wsRect = this.workspace.getBoundingClientRect();
    const st = this.workspace.scrollTop;
    const sl = this.workspace.scrollLeft;
    this.metrics = this.pages.map((pv) => {
      const node = pv.node;
      if (!node || node.style.display === 'none') return null;
      const r = node.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return {
        top: r.top - wsRect.top + st,
        left: r.left - wsRect.left + sl,
        height: r.height,
        width: r.width
      };
    });
    this._metricsDirty = false;
    this._lastWindow = '';
  }

  ensureMetrics() {
    if (this._metricsDirty) this.updateMetrics();
  }

  /** Index range of pages intersecting the viewport, plus a margin. */
  visibleRange(margin) {
    this.ensureMetrics();
    const horizontal = this.mode === 'horizontal';
    const pos = horizontal ? this.workspace.scrollLeft : this.workspace.scrollTop;
    const size = horizontal ? this.workspace.clientWidth : this.workspace.clientHeight;
    const from = pos - margin;
    const to = pos + size + margin;
    let first = -1, last = -1;
    for (let i = 0; i < this.metrics.length; i++) {
      const m = this.metrics[i];
      if (!m) continue;
      const start = horizontal ? m.left : m.top;
      const end = start + (horizontal ? m.width : m.height);
      if (end > from && start < to) {
        if (first < 0) first = i;
        last = i;
      }
    }
    return first < 0 ? { first: -1, last: -1 } : { first, last };
  }

  /* ---------- Rendering ---------- */
  renderVisible(force = false) {
    if (this.destroyed) return;
    if (this.mode === 'single') {
      this.requestRender(this.current, force);
      return;
    }
    const margin = Math.max(360, (this.workspace.clientHeight || 700) * 0.6);
    const { first, last } = this.visibleRange(margin);
    if (first < 0) return;
    const key = `${first}:${last}:${Math.round(this.scale * 100)}`;
    if (!force && key === this._lastWindow) return;
    this._lastWindow = key;

    this.visible.clear();
    for (let i = first; i <= last; i++) this.visible.add(i + 1);
    if (first !== this._sizeWindow?.[0] || last !== this._sizeWindow?.[1]) {
      this._sizeWindow = [first, last];
      this.ensureSizesAround(first, last).catch(() => {});
    }

    const busy = !force && (performance.now() - (this._lastScrollAt || 0) < 110);
    for (let i = first; i <= last; i++) {
      const num = i + 1;
      if (busy) {
        // Scrolling: every page on screen gets a cheap preview, so nothing the reader
        // can see is ever left blank. Pages that already have pixels are skipped.
        this.requestRender(num, false, 'preview');
        continue;
      }
      this.requestRender(num, force);
    }
    if (busy) {
      clearTimeout(this._scrollRenderTimer);
      this._scrollRenderTimer = setTimeout(() => {
        if (!this.destroyed) this.renderVisible(true);
      }, 120);
    }
    this.trimCache();
    if (!busy) this.unmountDistant(first, last);
  }

  requestRender(num, force = false, quality = 'full') {
    const pv = this.pages[num - 1];
    if (!pv || this.destroyed) return;
    if (pv.rendering) return;
    if (quality === 'preview') {
      if (pv.rendered) return;                 // a preview is only worth it on a blank page
    } else if (pv.rendered && !pv.stale && !force && pv.quality === 'full') {
      return;
    }
    this.queue.run(async () => {
      if (this.destroyed) return;
      if (!force) {
        // Never begin a long render on top of an interaction: a tap or a swipe must be
        // painted first (this is what INP measures).
        const since = performance.now() - Math.max(this._lastInteraction || 0, this._lastScrollAt || 0);
        if (since < 100) {
          await new Promise((r) => setTimeout(r, Math.min(160, 110 - since)));
          if (this.destroyed) return;
        }
      }
      if (quality === 'full' && !this.visible.has(num) && !force && pv.quality !== 'full') return;
      if (quality === 'preview' && pv.rendered) return;
      if (quality === 'full' && pv.rendered && !pv.stale && !force && pv.quality === 'full') return;
      if (!pv.wrap) {
        // The real node replaces a placeholder of identical size, so layout (and the
        // cached metrics) stay valid — no forced re-measure while scrolling.
        const parent = pv.placeholder?.parentElement || this.stack;
        pv.mountInto(parent);
        pv.applySize(this.scale);
      }
      await pv.render(this.doc, { scale: this.scale, profile: this.profile, dpr: this.dpr, quality });
      this.renderedOrder = this.renderedOrder.filter((n) => n !== num);
      this.renderedOrder.push(num);
      this.trimCache();
      // Selectable text appears right after the pixels, so the first page is
      // searchable/selectable without waiting for a zoom.
      if (!this.zooming && quality !== 'preview') pv.ensureTextLayer(this.doc, this.scale);
      this.onEvent('pageRendered', { page: num, quality });
      // A preview is a stopgap: sharpen it once the main thread has a moment.
      if (quality === 'preview' && this.visible.has(num) && !this.zooming) {
        setTimeout(() => { if (!this.destroyed) this.requestRender(num, true, 'full'); }, 40);
      }
    }).catch((e) => console.warn('render queue', e));
  }

  buildTextLayers() {
    const margin = 200;
    const { first, last } = this.visibleRange(margin);
    for (let i = Math.max(0, first); i <= last; i++) {
      const pv = this.pages[i];
      if (pv && pv.rendered) pv.ensureTextLayer(this.doc, this.scale);
    }
  }

  /** Replace far-away page nodes with placeholders: DOM and memory stay flat. */
  unmountDistant(first, last) {
    const keep = 14;
    const from = first - keep;
    const to = last + keep;
    for (let i = 0; i < this.pages.length; i++) {
      const num = i + 1;
      if (num >= from && num <= to) continue;
      const pv = this.pages[i];
      if (!pv.wrap || pv.rendering) continue;
      pv.release();
      const ph = pv.createPlaceholder();
      pv.wrap.replaceWith(ph);
      pv.wrap = null;
      this.layers?.delete?.(num);
    }
  }

  trimCache() {
    const limit = Math.max(3, this.profile.cachePages || 4);
    let guard = 0;
    while (this.renderedOrder.length > limit && guard++ < 64) {
      const candidate = this.renderedOrder[0];
      if (this.visible.has(candidate) || candidate === this.current) {
        this.renderedOrder.push(this.renderedOrder.shift());
        if (this.renderedOrder.every((n) => this.visible.has(n))) break;
        continue;
      }
      this.renderedOrder.shift();
      this.pages[candidate - 1]?.release();
    }
  }

  /* ---------- Navigation ---------- */
  attachInteractions() {
    const touch = () => {
      this._lastInteraction = performance.now();
      // Drop renders that have not started yet: the reader is doing something else and
      // renderVisible() will ask again when they stop.
      if (this.queue.pending > 0) this.queue.clear();
    };
    ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach((evt) =>
      this.workspace.addEventListener(evt, touch, { passive: true, capture: true }));
    this._onScroll = () => this.onScrollFrame(false);
    this.workspace.addEventListener('scroll', this._onScroll, { passive: true });

    this._onResize = debounce(() => {
      const spec = this.zoomSpec;
      if (['page-width', 'page-fit', 'width', 'page'].includes(spec)) {
        this.computeScale();
        this.updateMetrics();
        this.goToPage(this.current, { smooth: false, silent: true });
        this.renderVisible(true);
        this.onEvent('zoomChanged', { scale: this.scale, percent: Math.round(this.scale * 100) });
        this.scheduleSettle();
      } else {
        this.updateMetrics();
        this.renderVisible(true);
      }
    }, 200);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);

    this._pd = (e) => this.onPointerDown(e);
    this._pm = (e) => this.onPointerMove(e);
    this._pu = (e) => this.onPointerUp(e);
    this._wheel = (e) => this.onWheel(e);
    this._dbl = (e) => this.onDoubleClick(e);
    this._keydown = (e) => this.onKeyDown(e);
    this._keyup = (e) => this.onKeyUp(e);

    this.workspace.addEventListener('pointerdown', this._pd, { passive: false });
    this.workspace.addEventListener('pointermove', this._pm, { passive: false });
    this.workspace.addEventListener('pointerup', this._pu);
    this.workspace.addEventListener('pointercancel', this._pu);
    this.workspace.addEventListener('wheel', this._wheel, { passive: false });
    this.workspace.addEventListener('dblclick', this._dbl);
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
  }

  onScrollFrame(force) {
    if (this.destroyed) return;
    this._lastScrollAt = performance.now();
    const num = this.pageAtViewport();
    if (num !== this.current && this.mode !== 'single') {
      this.current = num;
      this.history.push(num);
      if (this.history.length > 40) this.history.shift();
      this.onEvent('pageChanged', { page: num, total: this.pages.length });
    }
    this.renderVisible(force);
    this.onEvent('scroll', { page: this.current, progress: this.scrollProgress() });
  }

  pageAtViewport() {
    if (this.mode === 'single') return this.current;
    this.ensureMetrics();
    const horizontal = this.mode === 'horizontal';
    const pos = (horizontal ? this.workspace.scrollLeft : this.workspace.scrollTop) + 24;
    let best = this.current, bestDist = Infinity;
    for (let i = 0; i < this.metrics.length; i++) {
      const m = this.metrics[i];
      if (!m) continue;
      const start = horizontal ? m.left : m.top;
      const end = start + (horizontal ? m.width : m.height);
      if (end < pos - 4) continue;
      const dist = Math.abs(start - pos);
      if (dist < bestDist) { bestDist = dist; best = i + 1; }
      if (start > pos + 4) break;
    }
    return best;
  }

  scrollProgress() {
    const max = this.workspace.scrollHeight - this.workspace.clientHeight;
    if (max <= 0) return this.current / Math.max(1, this.pages.length);
    return clamp(this.workspace.scrollTop / max, 0, 1);
  }

  goToPage(num, { smooth = true, silent = false } = {}) {
    const target = clamp(Math.round(num), 1, this.pages.length);
    const pv = this.pages[target - 1];
    if (!pv) return;
    const changed = target !== this.current;
    this.current = target;

    if (this.mode === 'single') {
      this.pages.forEach((p, i) => {
        const node = p.node;
        if (node) node.style.display = i + 1 === target ? '' : 'none';
      });
      this._metricsDirty = true;
      this.requestRender(target, true);
    } else {
      this.ensureMetrics();
      const m = this.metrics[target - 1];
      if (m) {
        if (this.mode === 'horizontal') {
          this.workspace.scrollTo({ left: Math.max(0, m.left - 24), behavior: smooth ? 'smooth' : 'auto' });
        } else {
          this.workspace.scrollTo({ top: Math.max(0, m.top - 14), behavior: smooth ? 'smooth' : 'auto' });
        }
      }
      this.renderVisible(true);
    }
    if (!silent && changed) this.onEvent('pageChanged', { page: target, total: this.pages.length });
    return target;
  }

  nextPage() {
    const step = (this.mode === 'spread' || this.mode === 'book') ? 2 : 1;
    return this.goToPage(this.current + step);
  }

  prevPage() {
    const step = (this.mode === 'spread' || this.mode === 'book') ? 2 : 1;
    return this.goToPage(this.current - step);
  }

  firstPage() { return this.goToPage(1); }
  lastPage() { return this.goToPage(this.pages.length); }

  previousLocation() {
    if (this.history.length < 2) return this.current;
    this.history.pop();
    const prev = this.history[this.history.length - 1] || 1;
    return this.goToPage(prev);
  }

  pageSize(num = this.current) {
    const pv = this.pages[num - 1];
    if (!pv) return { width: 612, height: 792 };
    return { width: pv.cssWidth || pv.baseSize.width * this.scale, height: pv.cssHeight || pv.baseSize.height * this.scale };
  }

  /* ---------- Pan, pinch, wheel ---------- */
  setPanMode(on) {
    this.panMode = !!on;
    this.workspace.classList.toggle('pan-mode', this.panMode);
  }

  onKeyDown(e) {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target;
    const interactive = t && (
      t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
      t.isContentEditable || t.tagName === 'BUTTON' || (t.closest && t.closest('a, button'))
    );
    if (interactive) return;
    this.spaceHeld = true;
    this._spacePanned = false;
    this.workspace.classList.add('pan-ready');
    // Suppress the browser's Space scroll; if the key is released without a drag we
    // perform the page-down ourselves (see onKeyUp), so both habits still work.
    e.preventDefault();
  }

  onKeyUp(e) {
    if (e.code !== 'Space') return;
    const panned = this._spacePanned;
    this.spaceHeld = false;
    this._spacePanned = false;
    if (!this.panMode) this.workspace.classList.remove('pan-ready');
    if (!panned) {
      const step = (this.workspace.clientHeight || 700) * 0.9;
      this.workspace.scrollBy({ top: e.shiftKey ? -step : step, behavior: 'smooth' });
    }
  }

  onPointerDown(e) {
    if (e.pointerType === 'touch') {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: this.scale };
        this.panning = null;
        this.workspace.classList.remove('is-panning');
        return;
      }
    }

    // Touch keeps the browser's own panning (momentum, rubber-banding); we only
    // take over for mouse drags, the hand tool and Space-drag.
    const wantsPan = e.pointerType !== 'touch' && (e.button === 1 || this.panMode || this.spaceHeld);
    if (!wantsPan) return;
    if (e.target.closest('.annot-item')) return;
    if (e.target.closest('textarea, input, .annot-note-pop')) return;

    e.preventDefault();
    if (this.spaceHeld) this._spacePanned = true;
    this.panning = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      sl: this.workspace.scrollLeft,
      st: this.workspace.scrollTop
    };
    this.workspace.classList.add('is-panning');
    try { this.workspace.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  onPointerMove(e) {
    if (e.pointerType === 'touch' && this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const ratio = dist / this.pinch.dist;
        const pct = clamp(Math.round(this.pinch.scale * 100 * ratio), 25, 500);
        const mid = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
        if (!this._pinchRaf) {
          this._pinchRaf = requestAnimationFrame(() => {
            this._pinchRaf = 0;
            this.setZoom(pct, { at: mid });
          });
        }
        e.preventDefault();
        return;
      }
    }
    if (!this.panning || e.pointerId !== this.panning.id) return;
    const dx = e.clientX - this.panning.x;
    const dy = e.clientY - this.panning.y;
    this.workspace.scrollLeft = this.panning.sl - dx;
    this.workspace.scrollTop = this.panning.st - dy;
    e.preventDefault();
  }

  onPointerUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.panning && e.pointerId === this.panning.id) {
      this.panning = null;
      this.workspace.classList.remove('is-panning');
      try { this.workspace.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  }

  onWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return;      // plain wheel keeps native scrolling
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    const pct = clamp(Math.round(this.scale * 100 * factor), 25, 500);
    if (pct === Math.round(this.scale * 100)) return;
    this.setZoom(pct, { at: { clientX: e.clientX, clientY: e.clientY } });
  }

  onDoubleClick(e) {
    if (e.target.closest('textarea, input, .annot-note-pop')) return;
    if (e.target.closest('.annot-item')) return;
    const at = { clientX: e.clientX, clientY: e.clientY };
    if (this.scale * 100 >= 240) this.setZoom('page-width', { at });
    else this.setZoom(Math.min(400, Math.round(this.scale * 100 * 1.6)), { at });
  }

  /** Scale that would make the page exactly fit the workspace width. */
  fitWidthScale() {
    const wsW = this.workspace.clientWidth || 900;
    const pageW = this.sizes[this.current - 1]?.width || 612;
    const spread = this.mode === 'spread' || this.mode === 'book';
    return Math.max(0.1, (wsW - PAD_X * 2 - (spread ? this.gap + 6 : 0)) / (spread ? 2 : 1) / pageW);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this._zoomTimer);
    this.queue.clear();
    this.workspace.removeEventListener('scroll', this._onScroll);
    this.workspace.removeEventListener('pointerdown', this._pd);
    this.workspace.removeEventListener('pointermove', this._pm);
    this.workspace.removeEventListener('pointerup', this._pu);
    this.workspace.removeEventListener('pointercancel', this._pu);
    this.workspace.removeEventListener('wheel', this._wheel);
    this.workspace.removeEventListener('dblclick', this._dbl);
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this.pages.forEach((pv) => pv.destroy());
    this.pages = [];
    this.stack.replaceChildren();
  }
}
