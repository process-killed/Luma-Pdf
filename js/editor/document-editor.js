/**
 * Document model for the editor: sources, page order, rotations and overlays.
 * Nothing is written until export(), and the original file is never touched.
 */
import { openForRender } from '../tools/pdf-utils.js';
import { uid } from '../utils/files.js';
import { buildPdf } from './export.js';

export class DocumentEditor {
  constructor() {
    this.sources = new Map();   // id -> { id, name, bytes, pageCount }
    this.pages = [];            // [{ id, srcId, index, rotation }]
    this.overlays = [];         // [{ id, kind:'text'|'image', pages:[..]|'all', ... }]
    this.name = 'document.pdf';
    this.onChange = () => {};
    this.onProgress = () => {};
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
    pages.forEach((p) => { p.rotation = (p.rotation + delta + 360) % 360; });
    this.onChange();
  }

  delete(pages) {
    const ids = new Set(pages.map((p) => p.id));
    this.pages = this.pages.filter((p) => !ids.has(p.id));
    this.overlays.forEach((o) => {
      if (Array.isArray(o.pages)) o.pages = o.pages.filter((n) => n <= this.pages.length);
    });
    this.onChange();
  }

  duplicate(pages) {
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
    const [item] = this.pages.splice(fromIndex, 1);
    this.pages.splice(toIndex, 0, item);
    this.onChange();
  }

  extract(pages) {
    const ids = new Set(pages.map((p) => p.id));
    this.pages = this.pages.filter((p) => ids.has(p.id));
    this.onChange();
  }

  addOverlay(overlay) {
    this.overlays.push({ id: uid('ov'), ...overlay });
    this.onChange();
  }

  removeOverlay(id) {
    this.overlays = this.overlays.filter((o) => o.id !== id);
    this.onChange();
  }

  reset() {
    this.sources.clear();
    this.pages = [];
    this.overlays = [];
    this.name = 'document.pdf';
    this.onChange();
  }

  async export({ filename } = {}) {
    if (!this.pages.length) throw new Error('There are no pages to export.');
    const blob = await buildPdf(this, { onProgress: this.onProgress });
    return { blob, filename: filename || this.suggestName() };
  }

  suggestName() {
    const stem = (this.name || 'document.pdf').replace(/\.pdf$/i, '');
    return `${stem}-edited.pdf`;
  }
}
