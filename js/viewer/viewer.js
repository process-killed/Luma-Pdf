/**
 * Viewer — layout, virtualised rendering, zoom and navigation for an open PDF.
 * One instance per open document.
 */
import { PageView } from './renderer.js';
import { TaskQueue } from '../performance/memory-manager.js';
import { clamp, debounce, throttle } from '../utils/dom.js';
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
    this.scale = 1;
    this.rotation = 0;
    this.current = 1;
    this.visible = new Set();
    this.renderedOrder = [];
    this.queue = new TaskQueue(profile.maxConcurrentRenders || 2);
    this.destroyed = false;
    this.sizes = [];
    this._scrollHandler = null;
    this._onResize = null;
    this.history = [1];
  }

  async init({ startPage = 1, restoreScroll = null } = {}) {
    await this.measureSizes();
    this.buildPages();
    this.applyLayout();
    this.observe();
    this.computeScale();
    this.attachScroll();
    this.stack.style.setProperty('--page-gap', `${this.gap}px`);
    this.renderAround(startPage);
    if (startPage > 1) this.goToPage(startPage, { smooth: false, silent: true });
    if (restoreScroll) {
      requestAnimationFrame(() => {
        this.workspace.scrollTop = restoreScroll;
        this.updateCurrentPage();
      });
    }
    this.onEvent('ready', { pages: this.doc.numPages, scale: this.scale });
    setTimeout(() => { this.measureRemaining(); }, 400);
    return this;
  }

  /* ---------- Sizes ---------- */
  /**
   * Measure only the first page before the first paint, then fill in the rest in
   * the background. Large documents must not wait for hundreds of worker calls.
   */
  async measureSizes() {
    const n = this.doc.numPages;
    let base = { width: 612, height: 792 };
    try {
      const first = await this.doc.getPage(1);
      const vp = first.getViewport({ scale: 1, rotation: 0 });
      base = { width: vp.width, height: vp.height };
    } catch { /* fall back to letter size */ }
    this.sizes = new Array(n).fill(base);
  }

  async measureRemaining() {
    const n = this.doc.numPages;
    if (n < 2 || n > 800 || this.destroyed) return;
    const chunk = 16;
    for (let start = 2; start <= n; start += chunk) {
      if (this.destroyed) return;
      const nums = [];
      for (let i = start; i < Math.min(n + 1, start + chunk); i++) nums.push(i);
      await Promise.all(nums.map(async (num) => {
        try {
          const p = await this.doc.getPage(num);
          const vp = p.getViewport({ scale: 1, rotation: 0 });
          this.sizes[num - 1] = { width: vp.width, height: vp.height };
        } catch { /* keep default */ }
      }));
      // Apply to pages that have not been painted yet; painted pages keep their size.
      nums.forEach((num) => {
        const pv = this.pages[num - 1];
        if (pv && !pv.rendered) {
          pv.baseSize = this.sizes[num - 1];
          pv.applySize(this.scale);
        }
      });
      await new Promise((r) => setTimeout(r, 0));
    }
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
      if (mode === 'book') {
        rows.push([this.pages[0]]);
        i = 1;
      }
      while (i < this.pages.length) {
        rows.push(this.pages.slice(i, i + 2));
        i += 2;
      }
      for (const group of rows) {
        const row = document.createElement('div');
        row.className = 'spread-row';
        row.style.gap = `${Math.max(2, this.gap / 3)}px`;
        if (this.direction === 'rtl') row.style.flexDirection = 'row-reverse';
        group.forEach((pv) => { if (!pv.wrap) pv.mount(row); else row.append(pv.wrap); });
        this.stack.append(row);
      }
    } else {
      this.pages.forEach((pv) => {
        if (!pv.wrap) pv.mount(this.stack);
        else this.stack.append(pv.wrap);
      });
      if (this.direction === 'rtl' && mode === 'horizontal') this.stack.style.flexDirection = 'row-reverse';
      else this.stack.style.flexDirection = '';
    }

    if (mode === 'single') {
      this.pages.forEach((pv, idx) => {
        pv.wrap.style.display = idx + 1 === this.current ? '' : 'none';
      });
    } else {
      this.pages.forEach((pv) => { if (pv.wrap) pv.wrap.style.display = ''; });
    }
  }

  setMode(mode, { keepPage = true } = {}) {
    const target = this.current;
    this.mode = mode;
    this.pages.forEach((pv) => pv.release());
    this.renderedOrder = [];
    this.applyLayout();
    this.computeScale();
    this.observe();
    if (keepPage) this.goToPage(target, { smooth: false, silent: true });
    this.renderAround(target);
    this.onEvent('modeChanged', { mode });
  }

  setDirection(dir) {
    this.direction = dir;
    const target = this.current;
    this.applyLayout();
    this.goToPage(target, { smooth: false, silent: true });
    this.onEvent('modeChanged', { mode: this.mode, direction: dir });
  }

  setGap(gap) {
    this.gap = gap;
    this.stack.style.setProperty('--page-gap', `${gap}px`);
    this.stack.querySelectorAll('.spread-row').forEach((r) => { r.style.gap = `${Math.max(2, gap / 3)}px`; });
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
      const byW = (spread ? usableW / 2 : usableW) / pageW;
      const byH = usableH / pageH;
      scale = Math.min(byW, byH);
    } else if (spec === 'actual') {
      scale = 1;
    } else {
      const pct = typeof spec === 'number' ? spec : Number.parseFloat(String(spec)) || 100;
      scale = pct / 100;
    }
    scale = clamp(scale, 0.1, 8);
    this.scale = scale;
    this.pages.forEach((pv) => pv.applySize(scale));
    this.onEvent('zoomChanged', { scale, percent: Math.round(scale * 100) });
    return scale;
  }

  async setZoom(spec, { anchorPage = true } = {}) {
    const target = this.current;
    this.zoomSpec = spec;
    this.pages.forEach((pv) => pv.release());
    this.renderedOrder = [];
    this.computeScale();
    if (anchorPage) this.goToPage(target, { smooth: false, silent: true });
    this.renderAround(target);
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
    this.measureSizes().then(() => {
      this.pages.forEach((pv, i) => { pv.baseSize = this.sizes[i] || pv.baseSize; });
      this.computeScale();
      this.goToPage(target, { smooth: false, silent: true });
      this.renderAround(target);
      this.onEvent('rotationChanged', { rotation: this.rotation });
    });
  }

  /* ---------- Virtualisation ---------- */
  observe() {
    this.observer?.disconnect();
    if (!('IntersectionObserver' in window)) {
      this.pages.forEach((pv) => this.requestRender(pv.num));
      return;
    }
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const num = Number(entry.target.dataset.page);
        const pv = this.pages[num - 1];
        if (!pv) continue;
        if (entry.isIntersecting) {
          this.visible.add(num);
          this.requestRender(num);
        } else {
          this.visible.delete(num);
          this.maybeRelease(num);
        }
      }
    }, {
      root: this.workspace,
      rootMargin: '420px 0px',
      threshold: 0.01
    });
    this.pages.forEach((pv) => { if (pv.wrap) this.observer.observe(pv.wrap); });
  }

  requestRender(num) {
    const pv = this.pages[num - 1];
    if (!pv || pv.rendered || pv.rendering || this.destroyed) return;
    this.queue.run(async () => {
      if (this.destroyed) return;
      await pv.render(this.doc, { scale: this.scale, profile: this.profile, dpr: this.dpr });
      this.renderedOrder = this.renderedOrder.filter((n) => n !== num);
      this.renderedOrder.push(num);
      this.trimCache();
      this.onEvent('pageRendered', { page: num });
    }).catch((e) => console.warn('render queue', e));
  }

  trimCache() {
    const limit = Math.max(3, this.profile.cachePages || 4);
    while (this.renderedOrder.length > limit) {
      const candidate = this.renderedOrder[0];
      if (this.visible.has(candidate)) {
        // Move visible pages to the back instead of dropping them.
        this.renderedOrder.push(this.renderedOrder.shift());
        if (this.renderedOrder.every((n) => this.visible.has(n))) break;
        continue;
      }
      this.renderedOrder.shift();
      this.pages[candidate - 1]?.release();
    }
  }

  maybeRelease(num) {
    const pv = this.pages[num - 1];
    if (!pv) return;
    if (this.renderedOrder.length > (this.profile.cachePages || 4) + 2) {
      this.renderedOrder = this.renderedOrder.filter((n) => n !== num);
      pv.release();
    }
  }

  renderAround(pageNum) {
    const radius = Math.max(0, this.profile.preRender || 0);
    for (let i = pageNum - radius; i <= pageNum + radius; i++) {
      if (i >= 1 && i <= this.pages.length) this.requestRender(i);
    }
  }

  /* ---------- Navigation ---------- */
  attachScroll() {
    const onScroll = throttle(() => this.updateCurrentPage(), 80);
    this._scrollHandler = onScroll;
    this.workspace.addEventListener('scroll', onScroll, { passive: true });
    this._onResize = debounce(() => {
      const spec = this.zoomSpec;
      if (spec === 'page-width' || spec === 'page-fit' || spec === 'width' || spec === 'page') {
        this.setZoom(spec, { anchorPage: true });
      }
    }, 220);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  }

  pageAtViewport() {
    const wsRect = this.workspace.getBoundingClientRect();
    const horizontal = this.mode === 'horizontal';
    const anchor = horizontal ? wsRect.left + 40 : wsRect.top + 24;
    let best = this.current, bestDist = Infinity;
    for (const pv of this.pages) {
      if (!pv.wrap) continue;
      const r = pv.wrap.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const start = horizontal ? r.left : r.top;
      const end = horizontal ? r.right : r.bottom;
      if (end < (horizontal ? wsRect.left : wsRect.top) - 4) continue;
      if (start > (horizontal ? wsRect.right : wsRect.bottom) + 4) continue;
      const dist = Math.abs(start - anchor);
      if (dist < bestDist) { bestDist = dist; best = pv.num; }
    }
    return best;
  }

  updateCurrentPage() {
    if (this.mode === 'single') return;
    const num = this.pageAtViewport();
    if (num !== this.current) {
      this.current = num;
      this.history.push(num);
      if (this.history.length > 40) this.history.shift();
      this.renderAround(num);
      this.onEvent('pageChanged', { page: num, total: this.pages.length });
    }
    this.onEvent('scroll', { page: this.current, progress: this.scrollProgress() });
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
    this.current = target;

    if (this.mode === 'single') {
      this.pages.forEach((p, i) => {
        if (p.wrap) p.wrap.style.display = i + 1 === target ? '' : 'none';
      });
      this.requestRender(target);
      this.renderAround(target);
    } else if (pv.wrap) {
      const wsRect = this.workspace.getBoundingClientRect();
      const r = pv.wrap.getBoundingClientRect();
      if (this.mode === 'horizontal') {
        const left = this.workspace.scrollLeft + (r.left - wsRect.left) - 24;
        this.workspace.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
      } else {
        const top = this.workspace.scrollTop + (r.top - wsRect.top) - 14;
        this.workspace.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
      }
      this.renderAround(target);
    }
    if (!silent) this.onEvent('pageChanged', { page: target, total: this.pages.length });
    return target;
  }

  nextPage() {
    if (this.mode === 'single') return this.goToPage(this.current + 1);
    const step = this.mode === 'spread' || this.mode === 'book' ? 2 : 1;
    return this.goToPage(this.current + step);
  }

  prevPage() {
    if (this.mode === 'single') return this.goToPage(this.current - 1);
    const step = this.mode === 'spread' || this.mode === 'book' ? 2 : 1;
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

  /** Current CSS size of a page at the active scale (used by the annotation layer). */
  pageSize(num = this.current) {
    const pv = this.pages[num - 1];
    if (!pv) return { width: 612, height: 792 };
    return { width: pv.cssWidth || pv.baseSize.width * this.scale, height: pv.cssHeight || pv.baseSize.height * this.scale };
  }

  destroy() {
    this.destroyed = true;
    this.observer?.disconnect();
    if (this._scrollHandler) this.workspace.removeEventListener('scroll', this._scrollHandler);
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('orientationchange', this._onResize);
    }
    this.queue.clear();
    this.pages.forEach((pv) => pv.destroy());
    this.pages = [];
    this.stack.replaceChildren();
  }
}
