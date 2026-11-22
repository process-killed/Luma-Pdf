/**
 * Thumbnail sidebar — lazy canvas thumbnails with virtualisation,
 * click to jump and current-page tracking.
 */
import { renderPageToCanvas } from './pdf-engine.js';

function idle() {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 300 });
    else setTimeout(resolve, 16);
  });
}

export class ThumbnailPanel {
  constructor({ doc, viewer, container, profile, onSelect }) {
    this.doc = doc;
    this.viewer = viewer;
    this.container = container;
    this.profile = profile;
    this.onSelect = onSelect || (() => {});
    this.buttons = [];
    this.rendered = new Set();
    this.observer = null;
    this.queue = [];
    this.busy = false;
    this.width = profile.thumbnailWidth || 140;
  }

  async build() {
    this.container.replaceChildren();
    this.buttons = [];
    const list = document.createElement('div');
    list.className = 'thumb-list';
    const frag = document.createDocumentFragment();

    for (let i = 1; i <= this.doc.numPages; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb';
      btn.dataset.page = String(i);
      btn.setAttribute('aria-label', `Go to page ${i}`);
      btn.innerHTML = `<span class="thumb-num">${i}</span><span class="thumb-canvas-wrap"><span class="thumb-skel"></span></span>`;
      btn.addEventListener('click', () => this.onSelect(i));
      frag.append(btn);
      this.buttons.push(btn);
    }
    list.append(frag);
    this.container.append(list);
    this.observe();
    this.setCurrent(1);
    return this;
  }

  observe() {
    if (!('IntersectionObserver' in window)) {
      this.buttons.slice(0, 12).forEach((b) => this.request(Number(b.dataset.page)));
      return;
    }
    this.observer?.disconnect();
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) this.request(Number(e.target.dataset.page));
      });
    }, { root: this.container.closest('.sidebar-body') || null, rootMargin: '300px 0px' });
    this.buttons.forEach((b) => this.observer.observe(b));
  }

  request(num) {
    if (this.rendered.has(num) || this.queue.includes(num)) return;
    this.queue.push(num);
    this.pump();
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const num = this.queue.shift();
      if (this.rendered.has(num)) continue;
      // Yield between thumbnails: rendering is heavy on the main thread and
      // starving the event loop makes the whole viewer feel frozen.
      await idle();
      try { await this.renderThumb(num); } catch { /* skip */ }
    }
    this.busy = false;
  }

  async renderThumb(num) {
    const btn = this.buttons[num - 1];
    if (!btn) return;
    const holder = btn.querySelector('.thumb-canvas-wrap');

    // Reuse the main page bitmap when it is already on screen: cheaper, and it
    // avoids rendering the same PDF page proxy twice at once.
    const pv = this.viewer.pages[num - 1];
    if (pv?.rendered && pv.canvas && pv.canvas.width > 0) {
      const ratio = pv.canvas.height / pv.canvas.width;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(this.width);
      canvas.height = Math.round(this.width * ratio);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(pv.canvas, 0, 0, canvas.width, canvas.height);
      holder.replaceChildren(canvas);
      this.rendered.add(num);
      return;
    }

    const page = await this.doc.getPage(num);
    const base = page.getViewport({ scale: 1 });
    const scale = this.width / base.width;
    const canvas = document.createElement('canvas');
    await renderPageToCanvas(page, canvas, {
      scale,
      outputScale: Math.min(1.5, (this.profile.maxDevicePixelRatio || 1)),
      intent: 'print'
    });
    holder.replaceChildren(canvas);
    this.rendered.add(num);
  }

  /** Refresh a thumbnail once its page finished rendering in the viewer. */
  refreshFromViewer(num) {
    if (!this.rendered.has(num)) return;
    const pv = this.viewer.pages[num - 1];
    if (!pv?.rendered) return;
    this.rendered.delete(num);
    this.request(num);
  }

  setCurrent(num) {
    this.buttons.forEach((b, i) => {
      const on = i + 1 === num;
      b.setAttribute('aria-current', on ? 'true' : 'false');
      if (on && !this.rendered.has(num)) this.request(num);
      if (on) b.scrollIntoView({ block: 'nearest' });
    });
  }

  destroy() {
    this.observer?.disconnect();
    this.queue = [];
    this.container.replaceChildren();
  }
}
