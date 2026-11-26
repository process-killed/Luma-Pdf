/**
 * Page renderer — owns one page's DOM: canvas, text layer, search layer, annotation layer.
 *
 * Performance contract:
 *  - the canvas element and its bitmap are reused; zooming stretches the existing
 *    bitmap instead of blanking the page, so a zoom never shows an empty page;
 *  - the text layer is built on demand (after paint, when the zoom settles) and is
 *    CSS-scaled in the meantime, so selection survives a zoom gesture;
 *  - rendering is cancellable and buffers are released only when the page leaves the
 *    cache window.
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
    this.stale = true;
    this.rendering = null;
    this.renderTask = null;
    this.textLayerScale = 0;
    this.textLayerTask = null;
    this.page = null;
    this.searchRects = [];
    this.cssWidth = 0;
    this.cssHeight = 0;
  }

  /** Lightweight stand-in with the page's exact size (no canvas, no layers). */
  createPlaceholder() {
    const ph = document.createElement('div');
    ph.className = 'page-ph';
    ph.dataset.page = String(this.num);
    ph.setAttribute('aria-hidden', 'true');
    const w = Math.max(1, Math.round(this.baseSize.width * this.scale));
    const h = Math.max(1, Math.round(this.baseSize.height * this.scale));
    ph.style.width = `${w}px`;
    ph.style.height = `${h}px`;
    this.placeholder = ph;
    return ph;
  }

  get node() { return this.wrap || this.placeholder || null; }

  /** Replace the placeholder with the real page node (called when it nears the viewport). */
  mountInto(parent) {
    if (this.wrap) return this.wrap;
    const wrap = this.mount(parent);
    if (this.placeholder) {
      if (this.placeholder.parentElement) this.placeholder.replaceWith(wrap);
      else parent.append(wrap);
      this.placeholder = null;
    }
    return wrap;
  }

  mount(parent, { withTextLayer = true } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap is-loading';
    wrap.dataset.page = String(this.num);
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', `Page ${this.num}`);

    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.setAttribute('aria-hidden', 'true');
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
    annotEl.dataset.mode = 'select';
    wrap.append(annotEl);

    this.wrap = wrap;
    this.canvas = canvas;
    this.searchEl = searchEl;
    this.annotEl = annotEl;
    this.applySize(this.scale);
    if (this.searchRects?.length) this.redrawSearch();
    parent.append(wrap);
    return wrap;
  }

  /**
   * Size the page for the current zoom. If a bitmap already exists it is stretched
   * (CSS) and marked stale, which keeps the page visible while it re-renders.
   */
  applySize(scale = this.scale) {
    const changed = Math.abs(scale - this.scale) > 0.0001;
    this.scale = scale;
    const w = Math.max(1, Math.round(this.baseSize.width * scale));
    const h = Math.max(1, Math.round(this.baseSize.height * scale));
    this.cssWidth = w;
    this.cssHeight = h;
    // A page that is not mounted still has a placeholder: keep it exactly the size of
    // the real page, otherwise the stack (and the whole layout) is measured wrong.
    if (this.placeholder) {
      this.placeholder.style.width = `${w}px`;
      this.placeholder.style.height = `${h}px`;
    }
    if (!this.wrap) return;
    this.wrap.style.width = `${w}px`;
    this.wrap.style.height = `${h}px`;

    if (this.canvas && this.canvas.width > 0) {
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      if (changed) {
        this.stale = true;
        this.wrap.dataset.stale = 'true';
      }
    }
    // Keep the text layer aligned during a zoom gesture; it is rebuilt on settle.
    if (this.textLayerEl && this.textLayerScale && changed) {
      const k = scale / this.textLayerScale;
      this.textLayerEl.style.transform = `scale(${k})`;
      this.textLayerEl.style.transformOrigin = '0 0';
    }
  }

  async ensurePage(doc) {
    if (doc) this.docRef = doc;
    if (this.page) return this.page;
    this.page = await doc.getPage(this.num);
    const vp = this.page.getViewport({ scale: 1, rotation: this.rotation });
    this.baseSize = { width: vp.width, height: vp.height };
    return this.page;
  }

  /** Render the canvas only. The text layer is built separately by the viewer. */
  async render(doc, { scale, profile, dpr, quality = 'full' }) {
    if (this.rendering) return this.rendering;
    const page = await this.ensurePage(doc);
    const previewDpr = quality === 'preview' ? Math.min(1, 0.55) : dpr;
    const plan = computeRenderPlan(this.baseSize, this.baseSize.width * scale, profile, previewDpr);
    if (quality === 'preview') {
      // Cap the preview at roughly a quarter of the pixels of a full render.
      const capPixels = 900_000;
      if (plan.pixels > capPixels) {
        const k = Math.sqrt(capPixels / plan.pixels);
        plan.ratio = Math.max(0.2, plan.ratio * k);
        plan.pixels = plan.pixels * k * k;
      }
    }
    const rotation = this.rotation;
    const token = (this.renderToken = (this.renderToken || 0) + 1);

    this.rendering = (async () => {
      try {
        this.renderTask = await renderPageToCanvas(page, this.canvas, {
          scale: plan.scale,
          outputScale: plan.outputScale,
          rotation
        });
        if (token !== this.renderToken) return;      // a newer render superseded this one
        this.canvas.style.width = `${plan.cssWidth}px`;
        this.canvas.style.height = `${plan.cssHeight}px`;
        this.wrap.style.width = `${plan.cssWidth}px`;
        this.wrap.style.height = `${plan.cssHeight}px`;
        this.cssWidth = plan.cssWidth;
        this.cssHeight = plan.cssHeight;
        this.rendered = true;
        this.stale = false;
        this.quality = quality;
        this.wrap?.classList.remove('is-empty');
        this.wrap.classList.add('rendered');
        this.wrap.dataset.stale = 'false';
        this.redrawSearch();
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('Page render failed', this.num, err?.message);
          this.wrap.classList.add('render-error');
        }
      } finally {
        this.rendering = null;
        // Whatever happened (cancelled, superseded, failed) the page must never be a
        // plain white rectangle: either it has pixels or it shows the skeleton.
        if (!this.rendered) {
          this.wrap?.classList.remove('is-loading');
          this.wrap?.classList.add('is-empty');
        }
      }
    })();
    return this.rendering;
  }

  /** Build (or rebuild) the selectable text layer at the given scale. */
  async ensureTextLayer(doc, scale = this.scale) {
    if (!this.textLayerEl) return;
    if (Math.abs(this.textLayerScale - scale) < 0.01) return;
    if (this.textLayerTask) return this.textLayerTask;
    const lib = await engineReady();
    if (!lib.renderTextLayer) return;

    this.textLayerTask = (async () => {
      try {
        const page = await this.ensurePage(doc || this.docRef);
        const viewport = page.getViewport({ scale, rotation: this.rotation });
        const textContent = await page.getTextContent();
        const el = this.textLayerEl;
        el.replaceChildren();
        el.style.transform = 'none';
        el.style.width = `${this.cssWidth}px`;
        el.style.height = `${this.cssHeight}px`;
        // PDF.js positions text spans relative to this factor.
        el.style.setProperty('--scale-factor', String(scale));
        const task = lib.renderTextLayer({
          textContentSource: textContent,
          container: el,
          viewport,
          textDivs: [],
          textDivProperties: new WeakMap(),
          textContentItemsStr: [],
          isOffscreenCanvasSupported: true
        });
        await task.promise;
        this.textDivs = task.textDivs || [];
        this.textContentItemsStr = task.textContentItemsStr || [];
        this.textLayerScale = scale;
      } catch (e) {
        console.warn('Text layer unavailable for page', this.num, e?.message);
      } finally {
        this.textLayerTask = null;
      }
    })();
    return this.textLayerTask;
  }

  cancel() {
    try { this.renderTask?.renderTask?.cancel?.(); } catch { /* ignore */ }
    try { this.renderTask?.cancel?.(); } catch { /* ignore */ }
  }

  /** Free pixel buffers while keeping the DOM node in place. */
  release() {
    this.cancel();
    this.renderToken = (this.renderToken || 0) + 1;
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    if (this.textLayerEl) this.textLayerEl.replaceChildren();
    this.textLayerScale = 0;
    this.rendered = false;
    this.stale = true;
    this.rendering = null;
    this.wrap?.classList.remove('rendered');
    this.wrap?.classList.add('is-empty');     // shows the skeleton, not a blank sheet
    this.wrap?.removeAttribute('data-stale');
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
    const s = this.scale;
    const frag = document.createDocumentFragment();
    this.searchRects.forEach((r, i) => {
      const box = document.createElement('div');
      box.className = 'search-hit' + (i === this.activeSearchIndex ? ' is-active' : '');
      box.style.left = `${r.left * s}px`;
      box.style.top = `${r.top * s}px`;
      box.style.width = `${r.width * s}px`;
      box.style.height = `${r.height * s}px`;
      frag.append(box);
    });
    this.searchEl.append(frag);
  }

  clearSearch() {
    this.searchRects = [];
    this.searchEl?.replaceChildren();
  }
}

/** Geometry of a text item in page units (scale 1). */
export function textItemBox(item, scale = 1) {
  const tx = window.pdfjsLib.Util.transform([scale, 0, 0, scale, 0, 0], item.transform);
  const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(tx[3]) || 10;
  return {
    left: tx[4],
    top: tx[5] - fontHeight,
    width: (item.width || 0) * scale,
    height: fontHeight * 1.15,
    fontHeight
  };
}
