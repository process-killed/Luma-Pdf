/**
 * Whole-document search over the real PDF text layer.
 * Builds a light index per page on demand and maps matches to highlight rectangles.
 */
import { textItemBox } from './renderer.js';

export class SearchController {
  constructor({ doc, viewer, onState }) {
    this.doc = doc;
    this.viewer = viewer;
    this.onState = onState || (() => {});
    this.index = new Map();      // page -> items[]
    this.results = [];
    this.active = -1;
    this.term = '';
    this.cancelled = false;
    this.options = { caseSensitive: false, wholeWord: false };
  }

  async pageItems(num) {
    if (this.index.has(num)) return this.index.get(num);
    const page = await this.doc.getPage(num);
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string' || !item.str.trim()) continue;
      items.push({ str: item.str, transform: item.transform, width: item.width, hasEOL: !!item.hasEOL });
    }
    this.index.set(num, items);
    page.cleanup();
    return items;
  }

  buildRegex(term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = this.options.wholeWord ? `\\b${escaped}\\b` : escaped;
    return new RegExp(pattern, this.options.caseSensitive ? 'g' : 'gi');
  }

  async run(term, options = {}) {
    this.term = String(term || '');
    this.options = { ...this.options, ...options };
    this.results = [];
    this.active = -1;
    this.cancelled = false;
    this.viewer.pages.forEach((pv) => pv.clearSearch());
    if (this.term.trim().length < 1) {
      this.onState({ term: this.term, results: [], active: -1, done: true });
      return [];
    }
    const re = this.buildRegex(this.term);
    const total = this.doc.numPages;
    for (let num = 1; num <= total; num++) {
      if (this.cancelled) break;
      let items;
      try { items = await this.pageItems(num); } catch { continue; }
      let pageMatches = 0;
      for (const item of items) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(item.str)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          const box = textItemBox(item, 1);
          const charW = box.width / Math.max(1, item.str.length);
          const left = box.left + charW * m.index;
          const width = Math.max(2, charW * m[0].length);
          this.results.push({
            page: num,
            snippet: snippetAround(item.str, m.index, m[0].length),
            rect: { left, top: box.top, width, height: box.height }
          });
          pageMatches++;
        }
      }
      if (pageMatches) this.groupPage(num);
      if (num % 8 === 0) this.onState({ term: this.term, results: this.results, active: this.active, done: false, progress: num / total });
      if (num % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    if (this.results.length) this.setActive(0);
    this.onState({ term: this.term, results: this.results, active: this.active, done: true });
    return this.results;
  }

  /** Attach the highlight rectangles of one page to its PageView. */
  groupPage(num) {
    const pv = this.viewer.pages[num - 1];
    if (!pv) return;
    const rects = this.results.filter((r) => r.page === num).map((r) => r.rect);
    const pageMatches = this.results.filter((r) => r.page === num);
    const localActive = pageMatches.findIndex((r) => r === this.results[this.active]);
    pv.setSearchRects(rects, localActive);
  }

  regroupAll() {
    this.viewer.pages.forEach((pv) => pv.clearSearch());
    const pages = new Set(this.results.map((r) => r.page));
    pages.forEach((num) => this.groupPage(num));
  }

  setActive(i) {
    if (!this.results.length) return;
    this.active = ((i % this.results.length) + this.results.length) % this.results.length;
    const hit = this.results[this.active];
    this.viewer.goToPage(hit.page, { smooth: true });
    this.regroupAll();
    this.scrollToHit(hit);
    this.onState({ term: this.term, results: this.results, active: this.active, done: true });
  }

  scrollToHit(hit) {
    const pv = this.viewer.pages[hit.page - 1];
    if (!pv?.wrap) return;
    setTimeout(() => {
      const ws = this.viewer.workspace;
      const wrapRect = pv.wrap.getBoundingClientRect();
      const wsRect = ws.getBoundingClientRect();
      const targetTop = ws.scrollTop + (wrapRect.top - wsRect.top) + hit.rect.top * this.viewer.scale - ws.clientHeight * 0.35;
      ws.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }, 60);
  }

  next() { this.setActive(this.active + 1); }
  prev() { this.setActive(this.active - 1); }

  clear() {
    this.cancelled = true;
    this.results = [];
    this.active = -1;
    this.term = '';
    this.viewer.pages.forEach((pv) => pv.clearSearch());
    this.onState({ term: '', results: [], active: -1, done: true });
  }

  /** Re-apply highlight geometry after a zoom change. */
  refresh() { if (this.results.length) this.regroupAll(); }
}

function snippetAround(text, index, len) {
  const start = Math.max(0, index - 42);
  const end = Math.min(text.length, index + len + 42);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}
