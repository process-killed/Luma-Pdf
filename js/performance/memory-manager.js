// Concurrency limiter + canvas registry so long documents never blow up memory.
export class TaskQueue {
  constructor(limit = 2) { this.limit = Math.max(1, limit); this.running = 0; this.queue = []; }
  setLimit(n) { this.limit = Math.max(1, n); this.pump(); }
  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pump();
    });
  }
  pump() {
    while (this.running < this.limit && this.queue.length) {
      const job = this.queue.shift();
      this.running++;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => { this.running--; this.pump(); });
    }
  }
  clear() { this.queue = []; }
  get pending() { return this.queue.length; }
}

export class CanvasRegistry {
  constructor(maxCanvases = 24) { this.max = maxCanvases; this.items = new Map(); }
  register(key, canvas) {
    this.items.set(key, canvas);
    this.trim();
  }
  trim() {
    while (this.items.size > this.max) {
      const [key, canvas] = this.items.entries().next().value;
      canvas.width = 0;
      canvas.height = 0;
      this.items.delete(key);
    }
  }
  release(key) {
    const canvas = this.items.get(key);
    if (canvas) { canvas.width = 0; canvas.height = 0; this.items.delete(key); }
  }
  clear() {
    for (const canvas of this.items.values()) { canvas.width = 0; canvas.height = 0; }
    this.items.clear();
  }
}
