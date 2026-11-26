/**
 * Annotation system — viewer-side annotations that can be written into a new PDF.
 *
 * Coordinates are page units (CSS px at 100% zoom, origin top-left), so they convert
 * 1:1 to PDF points on export. The whole layer is scaled with one CSS transform, which
 * means zooming never rebuilds annotation DOM and never loses a stroke.
 *
 * Interaction design:
 *  - one draft element per gesture, updated in place (no node churn per pointermove);
 *  - the layer rect is measured once per gesture, not on every move;
 *  - selection toggles attributes instead of re-rendering the page;
 *  - ink strokes are smoothed with quadratic curves.
 */
import { uid } from '../utils/files.js';
import { toast } from '../ui/ui.js';

const DRAG_TYPES = new Set(['highlight', 'underline', 'strike', 'rect', 'ellipse', 'arrow', 'line']);
const INK_TYPES = new Set(['pen', 'marker']);
const CLICK_TYPES = new Set(['text', 'note', 'image', 'signature']);

export class AnnotationManager {
  constructor({ viewer, onChange, onSelect }) {
    this.viewer = viewer;
    this.onChange = onChange || (() => {});
    this.onSelect = onSelect || (() => {});
    this.items = [];
    this.tool = 'select';
    this.color = '#f2c744';
    this.strokeWidth = 2;
    this.opacity = 1;
    this.fontSize = 14;
    this.selectedId = null;
    this.pendingImage = null;
    this.undoStack = [];
    this.redoStack = [];
    this.attached = new WeakSet();
    this._draft = null;
    this._gesture = null;
    this._raf = 0;
  }

  /* ---------- state ---------- */
  setTool(tool) {
    this.tool = tool;
    this.select(null);
    this.viewer.pages.forEach((pv) => this.applyModeToLayer(pv));
  }

  setColor(color) { this.color = color; this.applyToSelected({ color }); }
  setStrokeWidth(w) { this.strokeWidth = w; this.applyToSelected({ strokeWidth: w }); }
  setOpacity(o) { this.opacity = o; this.applyToSelected({ opacity: o }); }
  setFontSize(s) { this.fontSize = s; }

  applyToSelected(patch) {
    if (!this.selectedId) return;
    const item = this.items.find((i) => i.id === this.selectedId);
    if (!item) return;
    Object.assign(item, patch);
    this.renderPage(item.page);
    this.commit();
  }

  snapshot() {
    this.undoStack.push(JSON.stringify(this.items));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  commit() { this.onChange(this.items); }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.items));
    this.items = JSON.parse(this.undoStack.pop());
    this.renderAll();
    this.commit();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.items));
    this.items = JSON.parse(this.redoStack.pop());
    this.renderAll();
    this.commit();
    return true;
  }

  load(items) {
    this.items = Array.isArray(items) ? items.map((i) => ({ ...i, id: i.id || uid('ann') })) : [];
    this.renderAll();
  }

  clearAll() {
    if (!this.items.length) return;
    this.snapshot();
    this.items = [];
    this.renderAll();
    this.commit();
  }

  clearPage(page) {
    this.snapshot();
    this.items = this.items.filter((i) => i.page !== page);
    this.renderPage(page);
    this.commit();
  }

  countFor(page) { return this.items.filter((i) => i.page === page).length; }

  select(id) {
    const prev = this.selectedId;
    this.selectedId = id;
    if (prev && prev !== id) this.paintSelected(prev, false);
    if (id) this.paintSelected(id, true);
  }

  paintSelected(id, on) {
    this.viewer.pages.forEach((pv) => {
      const node = pv.annotEl?.querySelector(`.annot-item[data-id="${id}"]`);
      if (node) {
        if (on) node.dataset.selected = 'true';
        else node.removeAttribute('data-selected');
      }
    });
  }

  deleteSelected() {
    if (!this.selectedId) return false;
    this.snapshot();
    const item = this.items.find((i) => i.id === this.selectedId);
    this.items = this.items.filter((i) => i.id !== this.selectedId);
    this.selectedId = null;
    if (item) this.renderPage(item.page);
    this.commit();
    return true;
  }

  duplicateSelected() {
    const item = this.items.find((i) => i.id === this.selectedId);
    if (!item) return false;
    this.snapshot();
    const copy = { ...item, id: uid('ann'), x: (item.x || 0) + 12, y: (item.y || 0) + 12 };
    if (item.points) copy.points = item.points.map((p) => ({ x: p.x + 12, y: p.y + 12 }));
    if (item.from) copy.from = { x: item.from.x + 12, y: item.from.y + 12 };
    if (item.to) copy.to = { x: item.to.x + 12, y: item.to.y + 12 };
    this.items.push(copy);
    this.renderPage(copy.page);
    this.commit();
    this.select(copy.id);
    return true;
  }

  /* ---------- layer wiring ---------- */
  attach() {
    this.viewer.pages.forEach((pv) => {
      if (!pv.annotEl) return;
      this.styleLayer(pv);
      if (this.attached.has(pv.annotEl)) return;
      this.attached.add(pv.annotEl);
      this.wireLayer(pv);
    });
    this.setTool(this.tool);
    this.renderAll();
  }

  /**
   * Wire one page's layer. Pages are unmounted when they scroll far away (to keep the
   * DOM small) and get a fresh layer when they come back, so this must be callable
   * again for any page — that is what used to make annotations stop working.
   */
  attachPage(num) {
    const pv = this.viewer.pages[num - 1];
    if (!pv || !pv.annotEl) return;
    this.styleLayer(pv);
    if (!this.attached.has(pv.annotEl)) {
      this.attached.add(pv.annotEl);
      this.wireLayer(pv);
      this.enableSelectInteractions(num);
      this.applyModeToLayer(pv);
      this.renderPage(num);
      return;
    }
    this.applyModeToLayer(pv);
  }

  applyModeToLayer(pv) {
    const el = pv.annotEl;
    if (!el) return;
    const tool = this.tool;
    el.dataset.mode = INK_TYPES.has(tool) || DRAG_TYPES.has(tool) ? 'draw'
      : CLICK_TYPES.has(tool) ? 'click' : 'select';
    el.dataset.selectable = tool === 'select' ? 'true' : 'false';
  }

  /** Keep the layer's transform in sync with the viewer zoom (one style write). */
  syncZoom() {
    this.viewer.pages.forEach((pv) => { if (pv.annotEl) this.styleLayer(pv); });
  }

  styleLayer(pv) {
    const s = this.viewer.scale;
    const el = pv.annotEl;
    el.style.width = `${pv.baseSize.width}px`;
    el.style.height = `${pv.baseSize.height}px`;
    el.style.transform = `scale(${s})`;
    el.style.transformOrigin = '0 0';
    el.style.setProperty('--inv', String(1 / s));
  }

  wireLayer(pv) {
    const layer = pv.annotEl;
    layer.addEventListener('pointerdown', (e) => this.onPointerDown(e, pv));
    layer.addEventListener('pointermove', (e) => this.onPointerMove(e, pv));
    layer.addEventListener('pointerup', (e) => this.onPointerUp(e, pv));
    layer.addEventListener('pointercancel', (e) => this.onPointerUp(e, pv));
  }

  localPoint(e, pv) {
    const g = this._gesture;
    const rect = g && g.pv === pv ? g.rect : pv.annotEl.getBoundingClientRect();
    const scale = g && g.pv === pv ? g.scale : this.viewer.scale;
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }

  onPointerDown(e, pv) {
    if (this.tool === 'select' || this.tool === 'pan' || this.tool === 'eraser') return;
    if (e.button !== undefined && e.button !== 0) return;

    this._gesture = {
      pv,
      rect: pv.annotEl.getBoundingClientRect(),
      scale: this.viewer.scale,
      pointerId: e.pointerId
    };
    const p = this.localPoint(e, pv);
    try { pv.annotEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    if (DRAG_TYPES.has(this.tool)) {
      this._draft = { page: pv.num, type: this.tool, start: p, current: p, node: null };
      this.createDraft(pv);
      e.preventDefault();
      return;
    }
    if (INK_TYPES.has(this.tool)) {
      this._draft = { page: pv.num, type: this.tool, points: [p], node: null, path: null };
      this.createDraft(pv);
      this.updateInkDraft();
      e.preventDefault();
      return;
    }
    if (CLICK_TYPES.has(this.tool)) {
      e.preventDefault();
      this.placeClickType(pv, p);
    }
  }

  onPointerMove(e, pv) {
    const d = this._draft;
    if (!d || d.page !== pv.num) return;
    const p = this.localPoint(e, pv);
    if (INK_TYPES.has(d.type)) {
      const last = d.points[d.points.length - 1];
      if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 1.2) return;   // skip sub-pixel noise
      d.points.push(p);
      if (!this._raf) {
        this._raf = requestAnimationFrame(() => {
          this._raf = 0;
          this.updateInkDraft();
        });
      }
    } else {
      d.current = p;
      this.updateShapeDraft();
    }
    e.preventDefault();
  }

  onPointerUp(e, pv) {
    const d = this._draft;
    if (!d || d.page !== pv.num) { this._gesture = null; return; }
    this._draft = null;
    this._gesture = null;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    d.node?.remove();

    if (INK_TYPES.has(d.type)) {
      if (d.points.length < 2) return;
      this.snapshot();
      this.items.push({
        id: uid('ann'), page: d.page, type: d.type,
        points: d.points.map((pt) => ({ x: round(pt.x), y: round(pt.y) })),
        color: this.color,
        strokeWidth: d.type === 'marker' ? this.strokeWidth * 4 : this.strokeWidth,
        opacity: d.type === 'marker' ? 0.4 : this.opacity
      });
      this.renderPage(d.page);
      this.commit();
      return;
    }

    // Text marks follow the real text lines, which is what readers expect from a
    // highlight: drag across a sentence and the whole line gets marked, even if the
    // gesture was perfectly flat.
    if (d.type === 'highlight' || d.type === 'underline' || d.type === 'strike') {
      const snapped = this.snapTextRects(pv, d.start, d.current);
      if (snapped.length) {
        this.snapshot();
        snapped.forEach((r) => this.items.push({
          id: uid('ann'), page: d.page, type: d.type,
          x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h),
          color: this.color,
          strokeWidth: this.strokeWidth,
          opacity: d.type === 'highlight' ? 0.35 : this.opacity
        }));
        this.renderPage(d.page);
        this.commit();
        return;
      }
    }

    const x = Math.min(d.start.x, d.current.x);
    const y = Math.min(d.start.y, d.current.y);
    const w = Math.abs(d.current.x - d.start.x);
    const hRaw = Math.abs(d.current.y - d.start.y);
    if (w < 3 && hRaw < 3) return;
    // A flat drag over a scanned page still produces a usable band.
    const h = (d.type === 'highlight' || d.type === 'underline' || d.type === 'strike')
      ? Math.max(hRaw, this.fontSize * 1.2)
      : hRaw;

    this.snapshot();
    this.items.push({
      id: uid('ann'), page: d.page, type: d.type,
      x: round(x), y: round(y), w: round(w), h: round(h),
      color: this.color,
      strokeWidth: this.strokeWidth,
      opacity: d.type === 'highlight' ? 0.35 : this.opacity,
      from: (d.type === 'line' || d.type === 'arrow') ? { x: round(d.start.x), y: round(d.start.y) } : undefined,
      to: (d.type === 'line' || d.type === 'arrow') ? { x: round(d.current.x), y: round(d.current.y) } : undefined
    });
    this.renderPage(d.page);
    this.commit();
  }

  /**
   * Collect the text spans under a drag and merge them into one rect per line.
   * Returns page-unit rects, or [] when the area has no text layer (e.g. a scan).
   */
  snapTextRects(pv, start, current) {
    const layer = pv.textLayerEl;
    if (!layer || !layer.childElementCount) return [];
    const s = this.viewer.scale;
    const layerRect = pv.annotEl.getBoundingClientRect();
    const x1 = Math.min(start.x, current.x) * s;
    const x2 = Math.max(start.x, current.x) * s;
    const y1 = Math.min(start.y, current.y) * s;
    const y2 = Math.max(start.y, current.y) * s;
    const flat = (y2 - y1) < 6;
    const rows = flat ? [(y1 + y2) / 2] : [y1, (y1 + y2) / 2, y2];

    const steps = Math.max(2, Math.min(30, Math.round((x2 - x1) / 20)));
    const found = new Map();
    for (let i = 0; i <= steps; i++) {
      const cx = layerRect.left + x1 + ((x2 - x1) * i) / steps;
      for (const cy of rows) {
        const stack = document.elementsFromPoint(cx, layerRect.top + cy) || [];
        for (const el of stack) {
          if (el.parentElement !== layer || !el.textContent || !el.textContent.trim()) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const top = (r.top - layerRect.top) / s;
          const left = Math.max((r.left - layerRect.left) / s, Math.min(start.x, current.x));
          const right = Math.min((r.right - layerRect.left) / s, Math.max(start.x, current.x));
          if (right - left < 1) continue;
          const key = Math.round(top / 4);            // group spans that share a line
          const prev = found.get(key);
          if (prev) {
            const nl = Math.min(prev.x, left);
            const nr = Math.max(prev.x + prev.w, right);
            found.set(key, { x: nl, y: Math.min(prev.y, top), w: nr - nl, h: Math.max(prev.h, r.height / s) });
          } else {
            found.set(key, { x: left, y: top, w: right - left, h: r.height / s });
          }
        }
      }
    }
    return [...found.values()];
  }

  /* ---------- drafts ---------- */
  createDraft(pv) {
    const d = this._draft;
    const node = document.createElement('div');
    node.className = 'annot-draft';
    if (INK_TYPES.has(d.type)) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'annot-svg');
      svg.setAttribute('width', String(pv.baseSize.width));
      svg.setAttribute('height', String(pv.baseSize.height));
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', this.color);
      path.setAttribute('stroke-width', String(d.type === 'marker' ? this.strokeWidth * 4 : this.strokeWidth));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('opacity', String(d.type === 'marker' ? 0.4 : this.opacity));
      svg.append(path);
      node.append(svg);
      d.path = path;
    } else {
      node.style.border = `1.5px dashed ${this.color}`;
      node.style.background = `${this.color}22`;
      if (d.type === 'ellipse') node.style.borderRadius = '50%';
    }
    node.style.pointerEvents = 'none';
    pv.annotEl.append(node);
    d.node = node;
  }

  updateShapeDraft() {
    const d = this._draft;
    if (!d?.node) return;
    const x = Math.min(d.start.x, d.current.x);
    const y = Math.min(d.start.y, d.current.y);
    d.node.style.left = `${x}px`;
    d.node.style.top = `${y}px`;
    d.node.style.width = `${Math.abs(d.current.x - d.start.x)}px`;
    d.node.style.height = `${Math.abs(d.current.y - d.start.y)}px`;
  }

  updateInkDraft() {
    const d = this._draft;
    if (!d?.path) return;
    d.path.setAttribute('d', smoothPath(d.points));
  }

  /* ---------- click types (text / note / image) ---------- */
  placeClickType(pv, p) {
    if (this.tool === 'image' || this.tool === 'signature') {
      if (!this.pendingImage) {
        toast(this.tool === 'signature' ? 'Draw a signature first, then click to place it.' : 'Choose an image first, then click to place it.', { type: 'warn' });
        return;
      }
      this.snapshot();
      const maxW = Math.min(240, pv.baseSize.width * 0.5);
      const ratio = this.pendingImage.height / this.pendingImage.width || 0.4;
      this.items.push({
        id: uid('ann'), page: pv.num, type: this.tool,
        x: round(p.x), y: round(p.y), w: round(maxW), h: round(maxW * ratio),
        imageSrc: this.pendingImage.src, opacity: 1
      });
      this.renderPage(pv.num);
      this.commit();
      this.pendingImage = null;
      return;
    }

    // Inline editor lives in the page wrapper (unscaled) so it stays readable at any zoom.
    const s = this.viewer.scale;
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:absolute;left:${p.x * s}px;top:${p.y * s}px;z-index:9;max-width:${Math.min(320, pv.baseSize.width * 0.6) * s}px`;
    const ta = document.createElement('textarea');
    ta.className = 'textarea';
    ta.style.cssText = `min-height:46px;background:#fff;color:#111;border:1.5px solid var(--accent);font-size:${Math.max(12, this.fontSize * s)}px`;
    ta.placeholder = this.tool === 'note' ? 'Note text…' : 'Type text…';
    wrap.append(ta);
    pv.wrap.append(wrap);
    setTimeout(() => ta.focus(), 0);

    const commitText = () => {
      const value = ta.value.trim();
      wrap.remove();
      if (!value) return;
      this.snapshot();
      if (this.tool === 'note') {
        this.items.push({
          id: uid('ann'), page: pv.num, type: 'note',
          x: round(p.x), y: round(p.y), w: 22, h: 22,
          text: value, color: '#f2c744', opacity: 1
        });
      } else {
        const lines = value.split('\n').length;
        this.items.push({
          id: uid('ann'), page: pv.num, type: 'text',
          x: round(p.x), y: round(p.y),
          w: round(Math.min(pv.baseSize.width - p.x - 8, 340)),
          h: round(this.fontSize * 1.4 * lines + 6),
          text: value, color: this.color, fontSize: this.fontSize, opacity: this.opacity
        });
      }
      this.renderPage(pv.num);
      this.commit();
    };
    ta.addEventListener('blur', commitText);
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ta.value = ''; ta.blur(); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) ta.blur();
    });
  }

  /* ---------- rendering ---------- */
  renderAll() {
    this.viewer.pages.forEach((pv) => this.renderPage(pv.num));
  }

  renderPage(num) {
    const pv = this.viewer.pages[num - 1];
    if (!pv?.annotEl) return;
    this.styleLayer(pv);
    const layer = pv.annotEl;
    layer.querySelectorAll('.annot-item, .annot-note-pop').forEach((n) => n.remove());
    const list = this.items.filter((i) => i.page === num);
    if (!list.length) return;
    const frag = document.createDocumentFragment();
    for (const item of list) {
      const node = this.buildNode(item, pv);
      if (!node) continue;
      node.dataset.id = item.id;
      if (item.id === this.selectedId) node.dataset.selected = 'true';
      frag.append(node);
    }
    layer.append(frag);
  }

  buildNode(item, pv) {
    const node = document.createElement('div');
    node.className = 'annot-item';
    const opacity = item.opacity ?? 1;

    if (item.type === 'highlight' || item.type === 'underline' || item.type === 'strike') {
      node.classList.add('annot-hl');
      node.style.cssText = `left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;`;
      if (item.type === 'highlight') {
        node.style.background = item.color;
        node.style.opacity = String(opacity);
      } else if (item.type === 'underline') {
        node.style.borderBottom = `${Math.max(1, item.strokeWidth)}px solid ${item.color}`;
      } else {
        node.style.borderTop = `${Math.max(1, item.strokeWidth)}px solid ${item.color}`;
        node.style.top = `${item.y + item.h * 0.55}px`;
        node.style.height = '0px';
      }
      return node;
    }

    if (item.type === 'rect' || item.type === 'ellipse') {
      node.style.cssText = `left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;border:${Math.max(1, item.strokeWidth)}px solid ${item.color};opacity:${opacity};`;
      if (item.type === 'ellipse') node.style.borderRadius = '50%';
      this.addHandles(node, item);
      return node;
    }

    if (item.type === 'line' || item.type === 'arrow') {
      const from = item.from || { x: item.x, y: item.y };
      const to = item.to || { x: item.x + item.w, y: item.y + item.h };
      const head = Math.max(6, (item.strokeWidth || 2) * 3.4);
      let arrow = '';
      if (item.type === 'arrow') {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const a1 = angle - Math.PI / 7, a2 = angle + Math.PI / 7;
        arrow = `<line x1="${to.x}" y1="${to.y}" x2="${to.x - head * Math.cos(a1)}" y2="${to.y - head * Math.sin(a1)}" stroke="${item.color}" stroke-width="${item.strokeWidth}" stroke-linecap="round"/>
                 <line x1="${to.x}" y1="${to.y}" x2="${to.x - head * Math.cos(a2)}" y2="${to.y - head * Math.sin(a2)}" stroke="${item.color}" stroke-width="${item.strokeWidth}" stroke-linecap="round"/>`;
      }
      node.style.cssText = `left:0;top:0;width:${pv.baseSize.width}px;height:${pv.baseSize.height}px;opacity:${opacity}`;
      node.innerHTML = `<svg class="annot-svg" width="${pv.baseSize.width}" height="${pv.baseSize.height}" style="position:absolute;inset:0"><line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${item.color}" stroke-width="${Math.max(1, item.strokeWidth)}" stroke-linecap="round"/>${arrow}</svg>`;
      return node;
    }

    if (item.type === 'pen' || item.type === 'marker') {
      node.style.cssText = `left:0;top:0;width:${pv.baseSize.width}px;height:${pv.baseSize.height}px;opacity:${opacity}`;
      node.innerHTML = `<svg class="annot-svg" width="${pv.baseSize.width}" height="${pv.baseSize.height}" style="position:absolute;inset:0"><path d="${smoothPath(item.points || [])}" fill="none" stroke="${item.color}" stroke-width="${Math.max(1, item.strokeWidth || 2)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      return node;
    }

    if (item.type === 'text') {
      node.classList.add('annot-text');
      node.style.cssText = `left:${item.x}px;top:${item.y}px;max-width:${item.w}px;color:${item.color};font-size:${item.fontSize || 14}px;opacity:${opacity};padding:2px 3px;`;
      node.textContent = item.text || '';
      this.addHandles(node, item);
      return node;
    }

    if (item.type === 'note') {
      node.classList.add('annot-note');
      node.style.cssText = `left:${item.x}px;top:${item.y}px;width:22px;height:22px;background:${item.color};font-size:11px`;
      node.textContent = 'N';
      node.title = item.text || '';
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = node.parentElement.querySelector('.annot-note-pop');
        if (existing) { existing.remove(); return; }
        const pop = document.createElement('div');
        pop.className = 'annot-note-pop';
        pop.style.left = `${item.x + 26}px`;
        pop.style.top = `${item.y}px`;
        pop.textContent = item.text || '';
        node.parentElement.append(pop);
        setTimeout(() => pop.addEventListener('click', () => pop.remove()), 0);
      });
      return node;
    }

    if (item.type === 'image' || item.type === 'signature') {
      const img = document.createElement('img');
      img.src = item.imageSrc;
      img.alt = item.type === 'signature' ? 'Signature' : 'Placed image';
      img.style.cssText = `width:${item.w}px;height:${item.h}px;object-fit:contain;pointer-events:none`;
      node.style.cssText = `left:${item.x}px;top:${item.y}px;opacity:${opacity}`;
      node.append(img);
      this.addHandles(node, item);
      return node;
    }

    return null;
  }

  addHandles(node, item) {
    if (!('w' in item) || item.type === 'highlight') return;
    const del = document.createElement('button');
    del.className = 'annot-delete';
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete annotation');
    del.innerHTML = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this.select(item.id);
      this.deleteSelected();
    });
    node.append(del);
    const handle = document.createElement('span');
    handle.className = 'annot-handle';
    handle.dataset.dir = 'se';
    handle.addEventListener('pointerdown', (e) => this.startResize(e, item, node));
    node.append(handle);
  }

  startResize(e, item, node) {
    e.stopPropagation();
    e.preventDefault();
    const s = this.viewer.scale;
    const start = { x: e.clientX, y: e.clientY, w: item.w, h: item.h };
    const move = (ev) => {
      item.w = Math.max(8, start.w + (ev.clientX - start.x) / s);
      item.h = Math.max(8, start.h + (ev.clientY - start.y) / s);
      node.style.width = `${item.w}px`;
      node.style.height = `${item.h}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.snapshot();
      this.renderPage(item.page);
      this.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---------- drag to move in select mode ---------- */
  enableSelectInteractions(num = null) {
    const pages = num ? [this.viewer.pages[num - 1]] : this.viewer.pages;
    pages.forEach((pv) => {
      if (!pv || !pv.annotEl || pv.annotEl.dataset.moveBound) return;
      pv.annotEl.dataset.moveBound = '1';
      pv.annotEl.addEventListener('pointerdown', (e) => {
        if (this.tool !== 'select') return;
        const target = e.target.closest('.annot-item');
        if (!target || e.target.classList.contains('annot-delete') || e.target.classList.contains('annot-handle')) return;
        const item = this.items.find((i) => i.id === target.dataset.id);
        if (!item) return;
        this.select(item.id);
        const s = this.viewer.scale;
        const start = { x: e.clientX, y: e.clientY, ix: item.x, iy: item.y };
        try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        const move = (ev) => {
          item.x = start.ix + (ev.clientX - start.x) / s;
          item.y = start.iy + (ev.clientY - start.y) / s;
          target.style.left = `${item.x}px`;
          target.style.top = `${item.y}px`;
          if (item.type === 'line' || item.type === 'arrow') {
            const dx = item.x - start.ix, dy = item.y - start.iy;
            if (item.from) item.from = { x: item.from.x + dx, y: item.from.y + dy };
            if (item.to) item.to = { x: item.to.x + dx, y: item.to.y + dy };
            this.renderPage(item.page);
            this.select(item.id);
          }
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          item.x = round(item.x);
          item.y = round(item.y);
          this.snapshot();
          this.renderPage(item.page);
          this.commit();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        e.preventDefault();
      });
      pv.annotEl.addEventListener('click', (e) => {
        if (this.tool === 'select' && !e.target.closest('.annot-item')) this.select(null);
      });
    });
  }

  /* ---------- export ---------- */
  async exportToPdf(pdfDoc) {
    const PDFLib = window.PDFLib;
    if (!PDFLib) throw new Error('pdf-lib is not loaded, so annotations cannot be written into the PDF.');
    const { rgb, StandardFonts } = PDFLib;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let written = 0, skipped = 0;
    const pages = pdfDoc.getPages();

    for (const item of this.items) {
      const page = pages[item.page - 1];
      if (!page) { skipped++; continue; }
      const { height: ph } = page.getSize();
      const color = hexToRgb(item.color || '#f2c744', rgb);
      const op = item.opacity ?? 1;
      const flipY = (y, h = 0) => ph - y - h;

      try {
        if (item.type === 'highlight') {
          page.drawRectangle({ x: item.x, y: flipY(item.y, item.h), width: item.w, height: item.h, color, opacity: 0.35, blendMode: 'Multiply' });
        } else if (item.type === 'underline') {
          page.drawLine({ start: { x: item.x, y: flipY(item.y + item.h) }, end: { x: item.x + item.w, y: flipY(item.y + item.h) }, thickness: item.strokeWidth || 1.5, color });
        } else if (item.type === 'strike') {
          const y = flipY(item.y + item.h * 0.55);
          page.drawLine({ start: { x: item.x, y }, end: { x: item.x + item.w, y }, thickness: item.strokeWidth || 1.5, color });
        } else if (item.type === 'rect') {
          page.drawRectangle({ x: item.x, y: flipY(item.y, item.h), width: item.w, height: item.h, borderColor: color, borderWidth: item.strokeWidth || 1.5, opacity: 0, borderOpacity: op });
        } else if (item.type === 'ellipse') {
          page.drawEllipse({ x: item.x + item.w / 2, y: flipY(item.y + item.h / 2), xScale: item.w / 2, yScale: item.h / 2, borderColor: color, borderWidth: item.strokeWidth || 1.5, opacity: 0, borderOpacity: op });
        } else if (item.type === 'line' || item.type === 'arrow') {
          const from = item.from || { x: item.x, y: item.y };
          const to = item.to || { x: item.x + item.w, y: item.y + item.h };
          page.drawLine({ start: { x: from.x, y: flipY(from.y) }, end: { x: to.x, y: flipY(to.y) }, thickness: item.strokeWidth || 1.5, color, opacity: op });
          if (item.type === 'arrow') {
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            const size = Math.max(5, (item.strokeWidth || 1.5) * 3.5);
            [-0.42, 0.42].forEach((off) => {
              page.drawLine({
                start: { x: to.x, y: flipY(to.y) },
                end: { x: to.x - size * Math.cos(angle + off), y: flipY(to.y - size * Math.sin(angle + off)) },
                thickness: item.strokeWidth || 1.5, color, opacity: op
              });
            });
          }
        } else if (item.type === 'pen' || item.type === 'marker') {
          const pts = item.points || [];
          for (let i = 1; i < pts.length; i++) {
            page.drawLine({
              start: { x: pts[i - 1].x, y: flipY(pts[i - 1].y) },
              end: { x: pts[i].x, y: flipY(pts[i].y) },
              thickness: item.strokeWidth || 2,
              color,
              opacity: item.type === 'marker' ? 0.4 : op,
              lineCap: 1
            });
          }
        } else if (item.type === 'text' || item.type === 'note') {
          const size = item.type === 'note' ? 9 : (item.fontSize || 14);
          const safe = toWinAnsi(item.text || '');
          if (!safe) { skipped++; continue; }
          const lines = wrapText(safe, item.type === 'note' ? 34 : Math.max(12, Math.floor((item.w || 200) / (size * 0.5))));
          let y = flipY(item.y + size);
          if (item.type === 'note') {
            page.drawRectangle({ x: item.x, y: flipY(item.y + lines.length * size * 1.3 + 6), width: 150, height: lines.length * size * 1.3 + 6, color: rgb(1, 0.97, 0.78), opacity: 0.95 });
            y = flipY(item.y + 12);
          }
          for (const line of lines) {
            page.drawText(line, { x: item.x + 2, y, size, font, color });
            y -= size * 1.3;
          }
        } else if (item.type === 'image' || item.type === 'signature') {
          const embedded = await embedImage(pdfDoc, item.imageSrc);
          if (!embedded) { skipped++; continue; }
          page.drawImage(embedded, { x: item.x, y: flipY(item.y, item.h), width: item.w, height: item.h, opacity: op });
        } else {
          skipped++;
          continue;
        }
        written++;
      } catch (e) {
        console.warn('Annotation export skipped', item.type, e?.message);
        skipped++;
      }
    }
    return { written, skipped };
  }
}

/** Quadratic-curve path through the sampled points — smoother than a polyline. */
function smoothPath(points) {
  if (!points || points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function round(n) { return Math.round(n * 100) / 100; }

function hexToRgb(hex, rgb) {
  const clean = String(hex || '#000000').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return rgb(0, 0, 0);
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

async function embedImage(pdfDoc, dataUrl) {
  if (!dataUrl) return null;
  if (/^data:image\/png/i.test(dataUrl)) return pdfDoc.embedPng(dataUrl);
  if (/^data:image\/jpe?g/i.test(dataUrl)) return pdfDoc.embedJpg(dataUrl);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return pdfDoc.embedPng(canvas.toDataURL('image/png'));
}

function toWinAnsi(text) {
  const replacements = {
    '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...', '\u00a0': ' '
  };
  return String(text || '')
    .replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u00a0]/g, (c) => replacements[c] || c)
    .replace(/[^\u0000-\u00ff]/g, '?');
}

function wrapText(text, maxChars) {
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= maxChars) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.filter((l, i) => l || i === 0);
}
