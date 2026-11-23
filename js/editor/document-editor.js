/**
 * Document model for the editor: sources, page order, rotations and overlays.
 * Nothing is written until export(), and the original file is never touched.
 */
import { openForRender } from '../tools/pdf-utils.js';
import { uid } from '../utils/files.js';
import { buildPdf } from './export.js';
import { loadPdfLib } from '../utils/pdflib.js';

export class DocumentEditor {
  constructor() {
    this.sources = new Map();   // id -> { id, name, bytes, pageCount }
    this.pages = [];            // [{ id, srcId, index, rotation }]
    this.overlays = [];         // [{ id, kind:'text'|'image', pages:[..]|'all', ... }]
    this.name = 'document.pdf';
    this.onChange = () => {};
    this.onProgress = () => {};
    this.past = [];
    this.future = [];
  }

  /* ---------- undo history ---------- */
  snapshot() {
    this.past.push(JSON.stringify({ pages: this.pages, overlays: this.overlays }));
    if (this.past.length > 50) this.past.shift();
    this.future = [];
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  undo() {
    if (!this.past.length) return false;
    this.future.push(JSON.stringify({ pages: this.pages, overlays: this.overlays }));
    const state = JSON.parse(this.past.pop());
    this.pages = state.pages;
    this.overlays = state.overlays;
    this.onChange();
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(JSON.stringify({ pages: this.pages, overlays: this.overlays }));
    const state = JSON.parse(this.future.pop());
    this.pages = state.pages;
    this.overlays = state.overlays;
    this.onChange();
    return true;
  }

  get pageCount() { return this.pages.length; }

  async addSource(file, { append = true } = {}) {
    const { doc, bytes } = await openForRender(file);
    const id = uid('src');
    this.sources.set(id, { id, name: file.name, bytes, pageCount: doc.numPages, doc });
    const pages = [];
    for (let i = 0; i < doc.numPages; i++) {
      pages.push({ id: uid('pg'), srcId: id, index: i, rotation: 0 });
    }
    if (append) this.pages.push(...pages);
    else this.pages = pages;
    if (this.sources.size === 1) this.name = file.name;
    this.onChange();
    return { id, pages, doc };
  }

  sourceOf(page) { return this.sources.get(page.srcId); }

  /** Thumbnail/doc handle for a page. */
  async pageDoc(page) {
    const src = this.sources.get(page.srcId);
    if (!src) throw new Error('A source document is missing.');
    if (!src.doc) {
      const { doc } = await openForRender(new File([src.bytes], src.name, { type: 'application/pdf' }));
      src.doc = doc;
    }
    return src.doc;
  }

  rotate(pages, delta = 90) {
    this.snapshot();
    pages.forEach((p) => { p.rotation = (p.rotation + delta + 360) % 360; });
    this.onChange();
  }

  delete(pages) {
    this.snapshot();
    const ids = new Set(pages.map((p) => p.id));
    this.pages = this.pages.filter((p) => !ids.has(p.id));
    this.overlays.forEach((o) => {
      if (Array.isArray(o.pages)) o.pages = o.pages.filter((n) => n <= this.pages.length);
    });
    this.onChange();
  }

  duplicate(pages) {
    this.snapshot();
    const ids = new Set(pages.map((p) => p.id));
    const out = [];
    this.pages.forEach((p) => {
      out.push(p);
      if (ids.has(p.id)) out.push({ ...p, id: uid('pg') });
    });
    this.pages = out;
    this.onChange();
  }

  move(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    this.snapshot();
    const [item] = this.pages.splice(fromIndex, 1);
    this.pages.splice(toIndex, 0, item);
    this.onChange();
  }

  extract(pages) {
    this.snapshot();
    const ids = new Set(pages.map((p) => p.id));
    this.pages = this.pages.filter((p) => ids.has(p.id));
    this.onChange();
  }

  addOverlay(overlay) {
    this.snapshot();
    this.overlays.push({ id: uid('ov'), ...overlay });
    this.onChange();
  }

  removeOverlay(id) {
    this.snapshot();
    this.overlays = this.overlays.filter((o) => o.id !== id);
    this.onChange();
  }

  /** Insert blank pages after a given index (0 = at the very start). */
  insertBlank(count = 1, atIndex = this.pages.length, size = null) {
    const base = size || (this.pages[atIndex - 1]?.blank ? this.pages[atIndex - 1].size : null)
      || { width: 595.28, height: 841.89 };
    this.snapshot();
    const added = [];
    for (let i = 0; i < count; i++) {
      added.push({ id: uid('pg'), srcId: null, index: -1, rotation: 0, blank: true, size: { ...base } });
    }
    this.pages.splice(atIndex, 0, ...added);
    this.onChange();
    return added;
  }

  reset() {
    this.sources.clear();
    this.pages = [];
    this.overlays = [];
    this.name = 'document.pdf';
    this.onChange();
  }

  async export({ filename } = {}) {
    await loadPdfLib();
    if (!this.pages.length) throw new Error('There are no pages to export.');
    const blob = await buildPdf(this, { onProgress: this.onProgress });
    return { blob, filename: filename || this.suggestName() };
  }

  suggestName() {
    const stem = (this.name || 'document.pdf').replace(/\.pdf$/i, '');
    return `${stem}-edited.pdf`;
  }
}
