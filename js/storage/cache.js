// Bounded LRU cache used for rendered page bitmaps and parsed metadata.
export class LRUCache {
  constructor(limit = 6) {
    this.limit = limit;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      const dropped = this.map.get(oldest);
      this.map.delete(oldest);
      if (dropped && typeof dropped.release === 'function') dropped.release();
    }
  }
  delete(key) { this.map.delete(key); }
  clear() {
    for (const v of this.map.values()) if (v && typeof v.release === 'function') v.release();
    this.map.clear();
  }
  get size() { return this.map.size; }
}
