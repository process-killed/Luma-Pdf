/**
 * Embed configuration: strict parsing and validation of the query contract.
 * Unknown parameters are ignored (never fatal); invalid values fall back to defaults.
 */
import { EMBED_PARAMS } from '../config.js';

const BOOL_TRUE = new Set(['1', 'true', 'yes', 'on', 'show']);
const BOOL_FALSE = new Set(['0', 'false', 'no', 'off', 'hide']);

export const EMBED_DEFAULTS = {
  file: '',
  page: 1,
  zoom: 'page-width',
  fit: null,
  toolbar: true,
  sidebar: false,
  navigation: true,
  search: true,
  download: true,
  print: true,
  fullscreen: true,
  controls: 'auto',
  mobileToolbar: true,
  theme: 'auto',
  background: 'light',
  pageMode: 'vertical',
  scroll: null,
  spread: false,
  direction: 'ltr',
  language: 'en',
  annotations: false,
  outline: false,
  readonly: false,
  minimal: false,
  hideLogo: false,
  watermark: ''
};

function asBool(value, fallback) {
  if (value == null || value === '') return fallback;
  const v = String(value).toLowerCase();
  if (BOOL_TRUE.has(v)) return true;
  if (BOOL_FALSE.has(v)) return false;
  return fallback;
}

function asEnum(value, allowed, fallback) {
  if (value == null || value === '') return fallback;
  const v = String(value).toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

function asInt(value, fallback, min = 1, max = 100000) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function safeFile(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value), location.href);
    if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) return '';
    if (url.protocol === 'data:' && !/^data:application\/pdf/i.test(String(value))) return '';
    return url.href;
  } catch { return ''; }
}

/**
 * @param {URLSearchParams} params
 * @returns {{config: object, warnings: string[], unknown: string[]}}
 */
export function parseEmbedConfig(params) {
  const warnings = [];
  const unknown = [];
  const known = new Set(EMBED_PARAMS.map((p) => p.key));
  const cfg = { ...EMBED_DEFAULTS };

  for (const key of params.keys()) {
    if (!known.has(key)) unknown.push(key);
  }

  cfg.file = safeFile(params.get('file'));
  if (params.get('file') && !cfg.file) warnings.push('The "file" parameter is not a permitted http(s) PDF URL.');

  cfg.page = asInt(params.get('page'), 1, 1, 100000);

  const zoom = params.get('zoom');
  if (zoom) {
    if (['page-width', 'page-fit', 'actual', 'width', 'page'].includes(zoom)) cfg.zoom = zoom === 'width' ? 'page-width' : zoom === 'page' ? 'page-fit' : zoom;
    else if (/^\d+$/.test(zoom)) cfg.zoom = String(Math.min(500, Math.max(25, Number(zoom))));
    else warnings.push(`Unknown zoom value "${zoom}" — using page-width.`);
  }
  if (params.get('fit')) {
    const fit = asEnum(params.get('fit'), ['width', 'page', 'auto'], 'auto');
    if (fit === 'width') cfg.zoom = 'page-width';
    if (fit === 'page') cfg.zoom = 'page-fit';
    cfg.fit = fit;
  }

  cfg.toolbar = asBool(params.get('toolbar'), cfg.toolbar);
  cfg.sidebar = asBool(params.get('sidebar'), cfg.sidebar);
  cfg.navigation = asBool(params.get('navigation'), cfg.navigation);
  cfg.search = asBool(params.get('search'), cfg.search);
  cfg.download = asBool(params.get('download'), cfg.download);
  cfg.print = asBool(params.get('print'), cfg.print);
  cfg.fullscreen = asBool(params.get('fullscreen'), cfg.fullscreen);
  cfg.controls = asEnum(params.get('controls'), ['auto', 'always', 'never'], cfg.controls);
  cfg.mobileToolbar = asBool(params.get('mobileToolbar'), cfg.mobileToolbar);
  cfg.theme = asEnum(params.get('theme'), ['light', 'dark', 'auto'], cfg.theme);
  cfg.background = asEnum(params.get('background'), ['light', 'dark', 'sepia', 'slate', 'paper'], cfg.background);
  cfg.pageMode = asEnum(params.get('pageMode'), ['single', 'vertical', 'horizontal', 'spread', 'book'], cfg.pageMode);
  if (params.get('scroll')) {
    cfg.scroll = asEnum(params.get('scroll'), ['vertical', 'horizontal'], 'vertical');
    cfg.pageMode = cfg.scroll === 'horizontal' ? 'horizontal' : 'vertical';
  }
  if (asBool(params.get('spread'), false)) cfg.pageMode = 'spread';
  cfg.direction = asEnum(params.get('direction'), ['ltr', 'rtl'], cfg.direction);
  cfg.language = asEnum(params.get('language'), ['en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur', 'ar', 'he', 'fr', 'de', 'es', 'pt', 'zh', 'ja', 'ko', 'ru'], 'en');
  cfg.annotations = asBool(params.get('annotations'), cfg.annotations);
  cfg.outline = asBool(params.get('outline'), cfg.outline);
  cfg.readonly = asBool(params.get('readonly'), cfg.readonly);
  cfg.minimal = asBool(params.get('minimal'), cfg.minimal);
  cfg.hideLogo = asBool(params.get('hideLogo'), cfg.hideLogo);
  cfg.watermark = String(params.get('watermark') || '').slice(0, 120);

  if (cfg.readonly) {
    cfg.download = false;
    cfg.print = false;
    cfg.annotations = false;
  }
  if (cfg.minimal) {
    cfg.sidebar = false;
    cfg.print = false;
    cfg.navigation = cfg.navigation;
  }
  return { config: cfg, warnings, unknown };
}

/** Build a query string from a config object (used by the generator). */
export function serializeEmbedConfig(cfg, { file = '' } = {}) {
  const params = new URLSearchParams();
  if (file) params.set('file', file);
  const defaults = EMBED_DEFAULTS;
  for (const [key, value] of Object.entries(cfg)) {
    if (key === 'file') continue;
    if (value === undefined || value === null || value === '' || value === defaults[key]) continue;
    if (key === 'page' && value === 1) continue;
    params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return params;
}

export function iframeSnippet(url, { width = '100%', height = '700', title = 'Luma PDF Viewer', lazy = true, fullscreen = true } = {}) {
  return `<iframe
  src="${url}"
  width="${width}"
  height="${height}"
  style="border:0"
  ${lazy ? 'loading="lazy"' : ''}
  ${fullscreen ? 'allowfullscreen' : ''}
  title="${title}"
></iframe>`;
}
