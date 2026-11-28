/**
 * Spotlight overlay: dims the page and cuts holes over the regions of interest.
 * Regions are normalised, so the same tour works on any screen.
 */
import { regionToBox } from './coords.js';

export class SpotlightOverlay {
  constructor(host) {
    this.host = host || document.body;
    this.el = null;
    this.layer = null;
  }

  ensure() {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.className = 'gp-spotlight';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="gp-spotlight-cut"></div>';
    this.host.append(el);
    this.el = el;
    this.layer = el.querySelector('.gp-spotlight-cut');
    return el;
  }

  /**
   * Show regions over a page element.
   * @param {HTMLElement} pageEl the page wrapper (position: relative)
   * @param {object} spot { regions, opacity, border, animate }
   */
  show(pageEl, spot) {
    if (!pageEl || !spot?.regions?.length) { this.hide(); return; }
    const el = this.ensure();
    el.style.setProperty('--gp-spot-opacity', String(spot.opacity ?? 0.55));
    el.style.setProperty('--gp-spot-border', `${spot.border ?? 2}px`);
    el.dataset.animate = spot.animate === false ? 'false' : 'true';
    el.dataset.ready = 'false';

    const rect = pageEl.getBoundingClientRect();
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;

    // A single box-shadow spread makes the "hole" without extra layers per region.
    const boxes = spot.regions.map((region) => {
      const box = document.createElement('div');
      box.className = 'gp-spot-hole';
      Object.assign(box.style, regionToBox(region));
      return box;
    });
    this.layer.replaceChildren(...boxes);
    requestAnimationFrame(() => { el.dataset.ready = 'true'; });
  }

  /** Keep the holes aligned when the page moves (scroll, zoom, resize). */
  reposition(pageEl) {
    if (!this.el || !pageEl || this.el.dataset.ready === 'false') return;
    const rect = pageEl.getBoundingClientRect();
    this.el.style.left = `${rect.left}px`;
    this.el.style.top = `${rect.top}px`;
    this.el.style.width = `${rect.width}px`;
    this.el.style.height = `${rect.height}px`;
  }

  hide() {
    if (!this.el) return;
    this.el.dataset.ready = 'false';
    this.el.remove();
    this.el = null;
    this.layer = null;
  }

  destroy() { this.hide(); }
}
