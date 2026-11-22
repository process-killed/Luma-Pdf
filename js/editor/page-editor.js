/**
 * Page grid: thumbnails, selection, drag-and-drop reordering and per-page actions.
 */
import { renderPageToCanvas } from '../viewer/pdf-engine.js';
import { icon } from '../ui/icons.js';

const THUMB_WIDTH = 150;

export class PageEditor {
  constructor({ editor, container, onChange, onOpenPage }) {
    this.editor = editor;
    this.container = container;
    this.onChange = onChange || (() => {});
    this.onOpenPage = onOpenPage || (() => {});
    this.selection = new Set();
    this.thumbs = new Map();     // page id -> canvas
    this.queue = [];
    this.busy = false;
    this.lastClickedId = null;
  }

  render() {
    const editor = this.editor;
    this.container.replaceChildren();

    if (!editor.pages.length) {
      this.container.innerHTML = `
        <div class="editor-empty">
          <div>
            <div style="display:flex;justify-content:center;margin-bottom:12px">${icon('file-plus', 'icon-lg')}</div>
            <h3 style="font-size:15px;margin-bottom:6px">No pages yet</h3>
            <p class="small muted" style="max-width:34ch">Add a PDF to start arranging pages. Everything happens locally.</p>
          </div>
        </div>`;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'page-grid';
    editor.pages.forEach((page, index) => {
      const card = this.buildCard(page, index);
      grid.append(card);
    });
    this.container.append(grid);
    this.pump();
    this.onChange(this.selectionInfo());
  }

  buildCard(page, index) {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.dataset.pageId = page.id;
    card.dataset.index = String(index);
    card.draggable = true;
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', this.selection.has(page.id) ? 'true' : 'false');
    card.tabIndex = 0;

    const cached = this.thumbs.get(page.id);
    card.innerHTML = `
      <div class="pc-thumb">${cached ? '' : `<div class="thumb-skel"></div>`}</div>
      <div class="pc-foot">
        <span>${index + 1}</span>
        <span class="pc-actions">
          <button data-act="rotate" title="Rotate 90°" aria-label="Rotate page ${index + 1}">${icon('rotate-cw', 'icon-sm')}</button>
          <button data-act="duplicate" title="Duplicate" aria-label="Duplicate page ${index + 1}">${icon('copy', 'icon-sm')}</button>
          <button data-act="delete" title="Delete" aria-label="Delete page ${index + 1}">${icon('trash', 'icon-sm')}</button>
        </span>
      </div>
      ${page.rotation ? `<span class="pc-badge">${page.rotation}°</span>` : ''}`;

    const thumbHost = card.querySelector('.pc-thumb');
    if (cached) {
      const img = document.createElement('canvas');
      img.width = cached.width;
      img.height = cached.height;
      img.getContext('2d').drawImage(cached, 0, 0);
      thumbHost.append(img);
    } else {
      this.queue.push({ page, host: thumbHost });
    }

    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.select(page.id, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey });
    });
    card.addEventListener('dblclick', () => this.onOpenPage(index));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.onOpenPage(index);
      if (e.key === ' ') { e.preventDefault(); this.select(page.id, { additive: e.ctrlKey || e.metaKey }); }
    });

    card.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'rotate') { this.editor.rotate([page], 90); this.invalidate(page.id); this.render(); }
        else if (act === 'duplicate') { this.editor.duplicate([page]); this.render(); }
        else if (act === 'delete') { this.editor.delete([page]); this.render(); }
      });
    });

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(index));
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      const rect = card.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      card.classList.toggle('drop-before', !after);
      card.classList.toggle('drop-after', after);
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drop-before', 'drop-after');
      const from = Number(e.dataTransfer.getData('text/plain'));
      const rect = card.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      let to = index + (after ? 1 : 0);
      if (from < to) to -= 1;
      this.editor.move(from, to);
      this.render();
    });

    return card;
  }

  invalidate(pageId) {
    this.thumbs.delete(pageId);
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      await new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 16)));
      try { await this.renderThumb(job); } catch { /* skip */ }
    }
    this.busy = false;
  }

  async renderThumb({ page, host }) {
    if (!host.isConnected) return;
    const doc = await this.editor.pageDoc(page);
    const proxy = await doc.getPage(page.index + 1);
    const base = proxy.getViewport({ scale: 1, rotation: page.rotation });
    const scale = THUMB_WIDTH / base.width;
    const canvas = document.createElement('canvas');
    await renderPageToCanvas(proxy, canvas, { scale, outputScale: Math.min(1.5, window.devicePixelRatio || 1), rotation: page.rotation, intent: 'print' });
    this.thumbs.set(page.id, canvas);
    if (!host.isConnected) return;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    host.replaceChildren(copy);
  }

  select(id, { additive = false, range = false } = {}) {
    if (range && this.lastClickedId) {
      const ids = this.editor.pages.map((p) => p.id);
      const a = ids.indexOf(this.lastClickedId);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.selection.add(ids[i]);
      }
    } else if (additive) {
      if (this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    } else {
      this.selection = new Set([id]);
    }
    this.lastClickedId = id;
    this.paintSelection();
    this.onChange(this.selectionInfo());
  }

  selectAll() {
    this.selection = new Set(this.editor.pages.map((p) => p.id));
    this.paintSelection();
    this.onChange(this.selectionInfo());
  }

  clearSelection() {
    this.selection.clear();
    this.paintSelection();
    this.onChange(this.selectionInfo());
  }

  paintSelection() {
    this.container.querySelectorAll('.page-card').forEach((card) => {
      card.setAttribute('aria-selected', this.selection.has(card.dataset.pageId) ? 'true' : 'false');
    });
  }

  selectedPages() {
    return this.editor.pages.filter((p) => this.selection.has(p.id));
  }

  /** Page numbers (1-based, in current order) for the selection. */
  selectionInfo() {
    const nums = this.editor.pages
      .map((p, i) => (this.selection.has(p.id) ? i + 1 : null))
      .filter((n) => n !== null);
    return { count: nums.length, numbers: nums, total: this.editor.pages.length };
  }

  targetPages(mode) {
    if (mode === 'all') return 'all';
    if (mode === 'selection') {
      const { numbers } = this.selectionInfo();
      return numbers.length ? numbers : this.editor.pages.map((_, i) => i + 1);
    }
    return 'all';
  }
}
