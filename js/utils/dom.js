// Small DOM helpers used across modules.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const on = (target, type, handler, opts) => {
  if (!target) return () => {};
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
};

export function debounce(fn, wait = 150) {
  let t = 0;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

export function throttle(fn, wait = 100) {
  let last = 0, timer = 0, lastArgs = null;
  return (...args) => {
    lastArgs = args;
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) { last = now; fn(...args); }
    else if (!timer) {
      timer = setTimeout(() => { timer = 0; last = Date.now(); fn(...lastArgs); }, remaining);
    }
  };
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const raf = (fn) => requestAnimationFrame(fn);
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isMac = () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
export const modKey = () => (isMac() ? 'meta' : 'ctrl');

export function trapFocus(container, { onEscape } = {}) {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  const handler = (e) => {
    if (e.key === 'Escape' && onEscape) { onEscape(e); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(container.querySelectorAll(sel)).filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}
