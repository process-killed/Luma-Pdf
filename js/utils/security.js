// Security helpers: escaping, origin checks, message validation.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Only allow safe hrefs — blocks javascript:, vbscript:, and data: documents. */
export function safeHref(url) {
  if (!url) return null;
  try {
    const u = new URL(url, location.href);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) return u.href;
  } catch { /* ignore */ }
  return null;
}

/**
 * Origin policy for postMessage.
 * Same-origin by default; extra origins must be declared explicitly by the embedder
 * through the `origin` parameter, which is only honoured for exact matches.
 */
export function originAllowed(origin, allowed = []) {
  if (!origin) return false;
  if (origin === location.origin) return true;
  return allowed.includes(origin);
}

export function parseAllowedOrigins(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[^/\s]+$/i.test(o));
}

const MESSAGE_COMMANDS = new Set([
  'setPage', 'setZoom', 'nextPage', 'previousPage', 'searchText', 'print', 'download',
  'toggleSidebar', 'toggleFullscreen', 'getDocumentInfo', 'setTheme', 'open'
]);

export function isKnownCommand(name) {
  return MESSAGE_COMMANDS.has(String(name || ''));
}

export function sanitizeMessagePayload(data) {
  if (data == null) return null;
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') return data;
  if (typeof data === 'object' && !Array.isArray(data)) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    }
    return out;
  }
  return null;
}

/** Strip control characters and clamp length for anything rendered as text. */
export function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}
