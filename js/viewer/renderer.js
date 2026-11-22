/**
 * Page renderer — owns one page's DOM: canvas, text layer, search layer, annotation layer.
 * Rendering is cancellable and every buffer is released on request.
 */
import { engineReady, renderPageToCanvas } from './pdf-engine.js';
import { computeRenderPlan } from '../performance/adaptive-rendering.js';

export class PageView {
  /**
   * @param {number} num 1-based page number
   * @param {{width:number,height:number}} baseSize page size in CSS px at scale 1
   */
  constructor(num, baseSize) {
    this.num = num;
    this.baseSize = baseSize;
    this.rotation = 0;
    this.scale = 1;
    this.wrap = null;
    this.canvas = null;
    this.textLayerEl = null;
    this.searchEl = null;
    this.annotEl = null;
    this.rendered = false;
    this.rendering = null;
    this.renderTask = null;
    this.textLayer = null;
    this.page = null;
    this.searchRects = [];
    this.visible = false;
  }

  mount(parent, { withTextLayer = true } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap is-loading';
    wrap.dataset.page = String(this.num);
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', `Page ${this.num}`);

    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    wrap.append(canvas);

    if (withTextLayer) {
      const textLayerEl = document.createElement('div');
      textLayerEl.className = 'textLayer';
      wrap.append(textLayerEl);
      this.textLayerEl = textLayerEl;
    }

    const searchEl = document.createElement('div');
    searchEl.className = 'search-layer';
    wrap.append(searchEl);

    const annotEl = document.createElement('div');
    annotEl.className = 'annotation-layer';
    annotEl.dataset.page = String(this.num);
    wrap.append(annotEl);

    this.wrap = wrap;
    this.canvas = canvas;
    this.searchEl = searchEl;
    this.annotEl = annotEl;
    this.applySize();
    parent.append(wrap);
    return wrap;
  }

  applySize(scale = this.scale) {
    this.scale = scale;
    if (!this.wrap) return;
    const w = Math.max(1, Math.round(this.baseSize.width * scale));
    const h = Math.max(1, Math.round(this.baseSize.height * scale));
    this.wrap.style.width = `${w}px`;
    this.wrap.style.height = `${h}px`;
    this.cssWidth = w;
    this.cssHeight = h;
  }

  /** Placeholder height without a canvas — keeps scroll position stable. */
  async ensurePage(doc) {
    if (this.page) return this.page;
    this.page = await doc.getPage(this.num);
    const vp = this.page.getViewport({ scale: 1, rotation: this.rotation });
    this.baseSize = { width: vp.width, height: vp.height };
    return this.page;
  }

  async render(doc, { scale, profile, dpr }) {
    if (this.rendered || this.rendering) return this.rendering;
    const page = await this.ensurePage(doc);
    const plan = computeRenderPlan(this.baseSize, this.baseSize.width * scale, profile, dpr);
    const rotation = this.rotation;

    this.rendering = (async () => {
      try {
        this.renderTask = await renderPageToCanvas(page, this.canvas, {
          scale: plan.scale,
          outputScale: plan.outputScale,
          rotation
        });
        this.canvas.style.width = `${plan.cssWidth}px`;
        this.canvas.style.height = `${plan.cssHeight}px`;
        this.wrap.style.width = `${plan.cssWidth}px`;
        this.wrap.style.height = `${plan.cssHeight}px`;
        this.rendered = true;
        this.wrap.classList.remove('is-loading');
        this.wrap.classList.add('rendered');
        await this.buildTextLayer(page, plan.scale);
        this.redrawSearch();
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('Page render failed', this.num, err);
          this.wrap.classList.remove('is-loading');
          this.wrap.classList.add('render-error');
        }
      } finally {
        this.rendering = null;
      }
    })();
    return this.rendering;
  }

  async buildTextLayer(page, scale) {
    if (!this.textLayerEl) return;
    const lib = await engineReady();
    if (!lib.renderTextLayer) return;
    this.textLayerEl.replaceChildren();
    this.textLayerEl.style.setProperty('--scale-factor', String(scale));
    this.textLayerEl.style.width = `${this.cssWidth}px`;
    this.textLayerEl.style.height = `${this.cssHeight}px`;
    try {
      const viewport = page.getViewport({ scale, rotation: this.rotation });
      const textContent = await page.getTextContent();
      const task = lib.renderTextLayer({
        textContentSource: textContent,
        container: this.textLayerEl,
        viewport,
        textDivs: [],
        textDivProperties: new WeakMap(),
        textContentItemsStr: [],
        isOffscreenCanvasSupported: true
      });
      await task.promise;
      this.textDivs = task.textDivs || [];
      this.textContentItemsStr = task.textContentItemsStr || [];
    } catch (e) {
      // Text selection is a progressive enhancement — never block the page on it.
      console.warn('Text layer unavailable for page', this.num, e?.message);
    }
  }

  cancel() {
    try { this.renderTask?.renderTask?.cancel?.(); } catch { /* ignore */ }
    try { this.renderTask?.cancel?.(); } catch { /* ignore */ }
  }

  /** Free pixel buffers while keeping the DOM node in place. */
  release() {
    this.cancel();
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    if (this.textLayerEl) this.textLayerEl.replaceChildren();
    this.rendered = false;
    this.rendering = null;
    this.textLayer = null;
    this.wrap?.classList.remove('rendered');
    this.wrap?.classList.add('is-loading');
    this.clearSearch();
  }

  destroy() {
    this.release();
    this.page?.cleanup?.();
    this.page = null;
    this.wrap?.remove();
    this.wrap = null;
  }

  /* ---------- Search highlights ---------- */
  setSearchRects(rects, activeIndex) {
    this.searchRects = rects || [];
    this.activeSearchIndex = activeIndex;
    this.redrawSearch();
  }

  redrawSearch() {
    if (!this.searchEl) return;
    this.searchEl.replaceChildren();
    if (!this.searchRects.length) return;
    const frag = document.createDocumentFragment();
    this.searchRects.forEach((r, i) => {
      const box = document.createElement('div');
      box.className = 'search-hit' + (i === this.activeSearchIndex ? ' is-active' : '');
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      frag.append(box);
    });
    this.searchEl.append(frag);
  }

  clearSearch() {
    this.searchRects = [];
    this.searchEl?.replaceChildren();
  }
}

/** Geometry of a text item in viewport (CSS) space at a given scale. */
export function textItemBox(item, scale) {
  const tx = window.pdfjsLib.Util.transform(
    [scale, 0, 0, scale, 0, 0],
    item.transform
  );
  const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(tx[3]) || 10;
  return {
    left: tx[4],
    top: tx[5] - fontHeight,
    width: (item.width || 0) * scale,
    height: fontHeight * 1.15,
    fontHeight
  };
}
