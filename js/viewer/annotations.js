/**
 * Annotation system — viewer-side annotations that can be written into a new PDF.
 * Geometry is stored in page units (CSS px at 100% zoom, origin top-left) so it is
 * independent of the current zoom and converts 1:1 to PDF points on export.
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
    this._bound = false;
    this._draft = null;
  }

  /* ---------- state ---------- */
  setTool(tool) {
    this.tool = tool;
    this.select(null);
    this.viewer.pages.forEach((pv) => {
      if (!pv.annotEl) return;
      pv.annotEl.dataset.mode = INK_TYPES.has(tool) || DRAG_TYPES.has(tool) ? 'draw' : tool === 'text' ? 'text' : 'select';
      pv.annotEl.dataset.selectable = tool === 'select' ? 'true' : 'false';
    });
    if (tool === 'text' || tool === 'note') this.viewer.pages.forEach((pv) => { if (pv.annotEl) pv.annotEl.dataset.mode = 'text'; });
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
    this.commit('Style changed');
  }

  snapshot() {
    this.undoStack.push(JSON.stringify(this.items));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  commit(message) {
    this.onChange(this.items);
    this.viewer.pages.forEach((pv, i) => {
      if (this.items.some((it) => it.page === i + 1)) this.renderPage(i + 1);
    });
    if (message) this.onSelect({ message });
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.items));
    this.items = JSON.parse(this.undoStack.pop());
    this.renderAll();
    this.onChange(this.items);
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.items));
    this.items = JSON.parse(this.redoStack.pop());
    this.renderAll();
    this.onChange(this.items);
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
    this.renderAll();
    this.commit();
  }

  countFor(page) { return this.items.filter((i) => i.page === page).length; }

  select(id) {
    this.selectedId = id;
    this.renderAll();
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

  /* ---------- layer wiring ---------- */
  attach() {
    this.viewer.pages.forEach((pv) => {
      if (!pv.annotEl || this.attached.has(pv.annotEl)) return;
      this.attached.add(pv.annotEl);
      this.wireLayer(pv);
    });
    this.setTool(this.tool);
    this.renderAll();
  }

  wireLayer(pv) {
    const layer = pv.annotEl;
    layer.addEventListener('pointerdown', (e) => this.onPointerDown(e, pv));
    layer.addEventListener('pointermove', (e) => this.onPointerMove(e, pv));
    layer.addEventListener('pointerup', (e) => this.onPointerUp(e, pv));
    layer.addEventListener('pointercancel', (e) => this.onPointerUp(e, pv));
  }

  localPoint(e, pv) {
    const rect = pv.annotEl.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / this.viewer.scale, y: (e.clientY - rect.top) / this.viewer.scale };
  }

  onPointerDown(e, pv) {
    if (this.tool === 'select' || this.tool === 'pan' || this.tool === 'eraser') return;
    if (e.button !== undefined && e.button !== 0) return;
    const p = this.localPoint(e, pv);
    layerCapture(e, pv.annotEl);

    if (DRAG_TYPES.has(this.tool)) {
      this._draft = { page: pv.num, type: this.tool, start: p, current: p };
      this.showDraft(pv);
      return;
    }
    if (INK_TYPES.has(this.tool)) {
      this._draft = { page: pv.num, type: this.tool, points: [p] };
      this.showDraft(pv);
      return;
    }
    if (CLICK_TYPES.has(this.tool)) {
      // Prevent the browser's default focus handling from blurring the inline editor
      // we are about to create.
      e.preventDefault();
      this.placeClickType(pv, p);
    }
  }

  onPointerMove(e, pv) {
    if (!this._draft || this._draft.page !== pv.num) return;
    const p = this.localPoint(e, pv);
    if (INK_TYPES.has(this._draft.type)) this._draft.points.push(p);
    else this._draft.current = p;
    this.showDraft(pv);
  }

  onPointerUp(e, pv) {
    if (!this._draft || this._draft.page !== pv.num) return;
    const draft = this._draft;
    this._draft = null;
    this.clearDraft(pv);

    if (INK_TYPES.has(draft.type)) {
      if (draft.points.length < 2) return;
      this.snapshot();
      this.items.push({
        id: uid('ann'), page: draft.page, type: draft.type,
        points: draft.points.map((pt) => ({ x: round(pt.x), y: round(pt.y) })),
        color: this.color, strokeWidth: draft.type === 'marker' ? this.strokeWidth * 4 : this.strokeWidth,
        opacity: draft.type === 'marker' ? 0.4 : this.opacity
      });
      this.renderPage(draft.page);
      this.commit();
      return;
    }

    const x = Math.min(draft.start.x, draft.current.x);
    const y = Math.min(draft.start.y, draft.current.y);
    const w = Math.abs(draft.current.x - draft.start.x);
    const h = Math.abs(draft.current.y - draft.start.y);
    if (w < 4 && h < 4) return;

    this.snapshot();
    this.items.push({
      id: uid('ann'), page: draft.page, type: draft.type,
      x: round(x), y: round(y), w: round(w), h: round(h),
      color: this.color,
      strokeWidth: this.strokeWidth,
      opacity: draft.type === 'highlight' ? 0.35 : this.opacity,
      from: draft.type === 'line' || draft.type === 'arrow' ? { x: round(draft.start.x), y: round(draft.start.y) } : undefined,
      to: draft.type === 'line' || draft.type === 'arrow' ? { x: round(draft.current.x), y: round(draft.current.y) } : undefined
    });
    this.renderPage(draft.page);
    this.commit();
  }

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

    // Text and sticky notes: inline editor
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:absolute;left:${p.x * this.viewer.scale}px;top:${p.y * this.viewer.scale}px;z-index:9;max-width:${Math.min(320, pv.baseSize.width * 0.6) * this.viewer.scale}px`;
    const ta = document.createElement('textarea');
    ta.className = 'textarea';
    ta.style.cssText = 'min-height:48px;background:#fff;color:#111;border:1.5px solid var(--accent);font-size:' + (this.fontSize * this.viewer.scale) + 'px';
    ta.placeholder = this.tool === 'note' ? 'Note text…' : 'Type text…';
    wrap.append(ta);
    pv.annotEl.append(wrap);
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

  showDraft(pv) {
    this.clearDraft(pv);
    const d = this._draft;
    if (!d) return;
    const s = this.viewer.scale;
    const node = document.createElement('div');
    node.className = 'annot-draft';
    if (INK_TYPES.has(d.type)) {
      const pts = d.points.map((p) => `${p.x * s},${p.y * s}`).join(' ');
      node.innerHTML = `<svg class="annot-svg" width="${pv.cssWidth}" height="${pv.cssHeight}" style="position:absolute;inset:0"><polyline points="${pts}" fill="none" stroke="${this.color}" stroke-width="${(d.type === 'marker' ? this.strokeWidth * 4 : this.strokeWidth) * s}" stroke-linecap="round" stroke-linejoin="round" opacity="${d.type === 'marker' ? 0.4 : this.opacity}"/></svg>`;
    } else {
      const x = Math.min(d.start.x, d.current.x) * s;
      const y = Math.min(d.start.y, d.current.y) * s;
      const w = Math.abs(d.current.x - d.start.x) * s;
      const h = Math.abs(d.current.y - d.start.y) * s;
      node.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:1.5px dashed ${this.color};background:${this.color}22`;
      if (d.type === 'ellipse') node.style.borderRadius = '50%';
    }
    pv.annotEl.append(node);
  }

  clearDraft(pv) {
    pv.annotEl?.querySelectorAll('.annot-draft').forEach((n) => n.remove());
  }

  /* ---------- rendering ---------- */
  renderAll() {
    this.viewer.pages.forEach((pv) => this.renderPage(pv.num));
  }

  renderPage(num) {
    const pv = this.viewer.pages[num - 1];
    if (!pv?.annotEl) return;
    const layer = pv.annotEl;
    layer.querySelectorAll('.annot-item, .annot-note-pop').forEach((n) => n.remove());
    const s = this.viewer.scale;
    const list = this.items.filter((i) => i.page === num);

    for (const item of list) {
      const node = this.buildNode(item, s, pv);
      if (!node) continue;
      node.dataset.id = item.id;
      if (item.id === this.selectedId) node.dataset.selected = 'true';
      layer.append(node);
    }
  }

  buildNode(item, s, pv) {
    const node = document.createElement('div');
    node.className = 'annot-item';
    const opacity = item.opacity ?? 1;

    if (item.type === 'highlight' || item.type === 'underline' || item.type === 'strike') {
      node.classList.add('annot-hl');
      node.style.cssText = `left:${item.x * s}px;top:${item.y * s}px;width:${item.w * s}px;height:${item.h * s}px;`;
      if (item.type === 'highlight') {
        node.style.background = item.color;
        node.style.opacity = String(opacity);
      } else if (item.type === 'underline') {
        node.style.borderBottom = `${Math.max(1, item.strokeWidth * s)}px solid ${item.color}`;
      } else {
        node.style.borderTop = `${Math.max(1, item.strokeWidth * s)}px solid ${item.color}`;
        node.style.top = `${(item.y + item.h * 0.55) * s}px`;
        node.style.height = '0px';
      }
      this.addHandles(node, item);
      return node;
    }

    if (item.type === 'rect' || item.type === 'ellipse') {
      node.style.cssText = `left:${item.x * s}px;top:${item.y * s}px;width:${item.w * s}px;height:${item.h * s}px;border:${Math.max(1, item.strokeWidth * s)}px solid ${item.color};opacity:${opacity};`;
      if (item.type === 'ellipse') node.style.borderRadius = '50%';
      this.addHandles(node, item);
      return node;
    }

    if (item.type === 'line' || item.type === 'arrow') {
      const from = item.from || { x: item.x, y: item.y };
      const to = item.to || { x: item.x + item.w, y: item.y + item.h };
      const x1 = from.x * s, y1 = from.y * s, x2 = to.x * s, y2 = to.y * s;
      const head = Math.max(6, item.strokeWidth * 3.2) * Math.min(1.6, s);
      let arrow = '';
      if (item.type === 'arrow') {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const a1 = angle - Math.PI / 7, a2 = angle + Math.PI / 7;
        arrow = `<line x1="${x2}" y1="${y2}" x2="${x2 - head * Math.cos(a1)}" y2="${y2 - head * Math.sin(a1)}" stroke="${item.color}" stroke-width="${item.strokeWidth * s}" stroke-linecap="round"/>
                 <line x1="${x2}" y1="${y2}" x2="${x2 - head * Math.cos(a2)}" y2="${y2 - head * Math.sin(a2)}" stroke="${item.color}" stroke-width="${item.strokeWidth * s}" stroke-linecap="round"/>`;
      }
      node.style.cssText = `left:0;top:0;width:${pv.cssWidth}px;height:${pv.cssHeight}px;opacity:${opacity}`;
      node.innerHTML = `<svg class="annot-svg" width="${pv.cssWidth}" height="${pv.cssHeight}" style="position:absolute;inset:0"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${item.color}" stroke-width="${Math.max(1, item.strokeWidth * s)}" stroke-linecap="round"/>${arrow}</svg>`;
      return node;
    }

    if (item.type === 'pen' || item.type === 'marker') {
      const pts = (item.points || []).map((p) => `${p.x * s},${p.y * s}`).join(' ');
      node.style.cssText = `left:0;top:0;width:${pv.cssWidth}px;height:${pv.cssHeight}px;opacity:${opacity}`;
      node.innerHTML = `<svg class="annot-svg" width="${pv.cssWidth}" height="${pv.cssHeight}" style="position:absolute;inset:0"><polyline points="${pts}" fill="none" stroke="${item.color}" stroke-width="${Math.max(1, (item.strokeWidth || 2) * s)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      return node;
    }

    if (item.type === 'text') {
      node.classList.add('annot-text');
      node.style.cssText = `left:${item.x * s}px;top:${item.y * s}px;max-width:${item.w * s}px;color:${item.color};font-size:${(item.fontSize || 14) * s}px;opacity:${opacity};padding:2px 3px;`;
      node.textContent = item.text || '';
      this.addHandles(node, item);
      return node;
    }

    if (item.type === 'note') {
      node.className = 'annot-item annot-note';
      node.style.cssText = `left:${item.x * s}px;top:${item.y * s}px;width:${22 * s}px;height:${22 * s}px;background:${item.color};font-size:${11 * s}px`;
      node.textContent = 'N';
      node.title = item.text || '';
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = node.parentElement.querySelector('.annot-note-pop');
        if (existing) { existing.remove(); return; }
        const pop = document.createElement('div');
        pop.className = 'annot-note-pop';
        pop.style.left = `${item.x * s + 26}px`;
        pop.style.top = `${item.y * s}px`;
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
      img.style.cssText = `width:${item.w * s}px;height:${item.h * s}px;object-fit:contain;pointer-events:none`;
      node.style.cssText = `left:${item.x * s}px;top:${item.y * s}px;opacity:${opacity}`;
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
      node.style.width = `${item.w * s}px`;
      node.style.height = `${item.h * s}px`;
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
  enableSelectInteractions() {
    this.viewer.pages.forEach((pv) => {
      if (!pv.annotEl || pv.annotEl.dataset.moveBound) return;
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
        target.setPointerCapture?.(e.pointerId);
        const move = (ev) => {
          item.x = start.ix + (ev.clientX - start.x) / s;
          item.y = start.iy + (ev.clientY - start.y) / s;
          target.style.left = `${item.x * s}px`;
          target.style.top = `${item.y * s}px`;
          if (item.type === 'line' || item.type === 'arrow') {
            const dx = item.x - start.ix, dy = item.y - start.iy;
            if (item.from) item.from = { x: item.from.x + dx, y: item.from.y + dy };
            if (item.to) item.to = { x: item.to.x + dx, y: item.to.y + dy };
            this.renderPage(item.page);
          }
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          item.x = round(item.x); item.y = round(item.y);
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
  /**
   * Write every annotation into an existing pdf-lib document.
   * @returns {Promise<{written:number, skipped:number}>}
   */
  async exportToPdf(pdfDoc) {
    const PDFLib = window.PDFLib;
    if (!PDFLib) throw new Error('pdf-lib is not loaded, so annotations cannot be written into the PDF.');
    const { rgb, StandardFonts, degrees } = PDFLib;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let written = 0, skipped = 0;

    const pages = pdfDoc.getPages();
    for (const item of this.items) {
      const page = pages[item.page - 1];
      if (!page) { skipped++; continue; }
      const { width: pw, height: ph } = page.getSize();
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

function layerCapture(e, el) {
  try { el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
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
  // Convert anything else (webp, svg, gif) through a canvas first.
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const png = canvas.toDataURL('image/png');
  return pdfDoc.embedPng(png);
}

/** Standard PDF fonts are WinAnsi-only; replace characters they cannot encode. */
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
