// URL parsing, validation and building.
import { ALLOWED_REMOTE_PROTOCOLS } from '../config.js';

export function getParams(search = location.search) {
  return new URLSearchParams(search || '');
}

export function parseBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const v = String(value).toLowerCase().trim();
  if (['1', 'true', 'yes', 'on', 'show', 'enabled'].includes(v)) return true;
  if (['0', 'false', 'no', 'off', 'hide', 'disabled'].includes(v)) return false;
  return fallback;
}

export function parseIntSafe(value, fallback = 0, min = -Infinity, max = Infinity) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Returns a normalised absolute http(s) URL, or null when unsafe/invalid. */
export function normalizeUrl(input, base = location.href) {
  if (!input) return null;
  let raw = String(input).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    if (!ALLOWED_REMOTE_PROTOCOLS.includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function isHttpUrl(input) {
  return !!normalizeUrl(input);
}

/** A same-origin blob/object URL is safe to load directly. */
export function isBlobUrl(input) {
  return typeof input === 'string' && /^blob:/i.test(input);
}

export function sameOrigin(input) {
  try { return new URL(input, location.href).origin === location.origin; } catch { return false; }
}

export function filenameFromUrl(url, fallback = 'document.pdf') {
  try {
    const u = new URL(url, location.href);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    if (!last) return fallback;
    return /\.pdf$/i.test(last) ? last : last + '.pdf';
  } catch { return fallback; }
}

export function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export function absoluteAppUrl(path = 'embed', params = {}) {
  const base = new URL(path, location.href).href;
  const q = buildQuery(params);
  return q ? `${base}?${q}` : base;
}

/** Turn a loose embed spec into a URL against this deployment. */
export function embedUrlFor(fileUrl, options = {}) {
  return absoluteAppUrl('embed.html', { file: fileUrl, ...options });
}
