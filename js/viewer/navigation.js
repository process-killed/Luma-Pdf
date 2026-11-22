/**
 * Bookmarks and page history for an open document.
 */
import { uid } from '../utils/files.js';

export class BookmarkStore {
  constructor({ docKey, bookmarks = [], onChange }) {
    this.docKey = docKey;
    this.items = bookmarks;
    this.onChange = onChange || (() => {});
  }

  add(page, label) {
    const existing = this.items.find((b) => b.page === page);
    if (existing) return existing;
    const item = { id: uid('bm'), page, label: label || `Page ${page}`, createdAt: Date.now() };
    this.items.push(item);
    this.items.sort((a, b) => a.page - b.page);
    this.onChange(this.items);
    return item;
  }

  remove(id) {
    this.items = this.items.filter((b) => b.id !== id);
    this.onChange(this.items);
  }

  has(page) { return this.items.some((b) => b.page === page); }

  toggle(page, label) {
    const found = this.items.find((b) => b.page === page);
    if (found) { this.remove(found.id); return false; }
    this.add(page, label);
    return true;
  }
}

export class PageHistory {
  constructor(limit = 50) { this.stack = []; this.limit = limit; }
  push(page) {
    if (this.stack[this.stack.length - 1] === page) return;
    this.stack.push(page);
    if (this.stack.length > this.limit) this.stack.shift();
  }
  previous() {
    this.stack.pop();
    return this.stack[this.stack.length - 1] ?? null;
  }
  recent(n = 6) { return this.stack.slice(-n).reverse(); }
  clear() { this.stack = []; }
}
