/**
 * Luma PDF — central configuration.
 * Every tunable constant, the embed parameter contract, and the build stamp live here.
 */

export const APP = {
  name: 'Luma PDF',
  tagline: 'A universal PDF workspace that runs entirely in your browser.',
  origin: (typeof location !== 'undefined' ? location.origin + location.pathname.replace(/\/[^/]*$/, '/') : 'https://lumapdf.example/'),
  repo: 'https://github.com/',
  version: '1.7.0',
  build: '2026-11-28 12:20 IST',
  buildId: 'b2026-11-28-1'
};

/** Asset version query — bump together with APP.version on every real change. */
export const ASSET_V = '1.7.0';

export const PATHS = {
  pdfjs: 'vendor/pdfjs/pdf.min.js',
  pdfjsWorker: 'vendor/pdfjs/pdf.worker.min.js',
  cmaps: 'vendor/pdfjs/cmaps/',
  standardFonts: 'vendor/pdfjs/standard_fonts/',
  pdfLib: 'vendor/pdf-lib/pdf-lib.min.js'
};

export const STORAGE = {
  dbName: 'luma-pdf',
  dbVersion: 2,
  stores: {
    documents: 'documents',   // saved PDF blobs + metadata
    settings: 'settings',     // key/value preferences
    annotations: 'annotations', // per-document annotation sets
    bookmarks: 'bookmarks',   // per-document bookmarks
    reading: 'reading',       // per-document reading position
    tours: 'tours',           // GuidedPath tours (steps inline)
    tourAssets: 'tourAssets'  // narration audio + thumbnails, one record per asset
  },
  maxSavedDocuments: 60
};

export const GUIDEDPATH = {
  formatVersion: 1,
  formatId: 'luma-tour',
  maxSteps: 400,
  maxNarrationBytes: 12 * 1024 * 1024,
  maxPackageBytes: 64 * 1024 * 1024,
  maxTextLength: 8000,
  narrationMimes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']
};

export const PERFORMANCE = {
  profiles: ['eco', 'balanced', 'performance'],
  eco: {
    label: 'Eco',
    maxCanvasPixels: 2_200_000,
    maxDevicePixelRatio: 1,
    preRender: 1,
    maxConcurrentRenders: 2,
    thumbnailQuality: 0.55,
    thumbnailWidth: 110,
    cachePages: 3,
    animations: false
  },
  balanced: {
    label: 'Balanced',
    maxCanvasPixels: 4_600_000,
    maxDevicePixelRatio: 1.75,
    preRender: 1,
    maxConcurrentRenders: 3,
    thumbnailQuality: 0.75,
    thumbnailWidth: 150,
    cachePages: 5,
    animations: true
  },
  performance: {
    label: 'Performance',
    maxCanvasPixels: 12_000_000,
    maxDevicePixelRatio: 2,
    preRender: 2,
    maxConcurrentRenders: 3,
    thumbnailQuality: 0.9,
    thumbnailWidth: 190,
    cachePages: 8,
    animations: true
  }
};

export const VIEWER_DEFAULTS = {
  mode: 'vertical',        // single | vertical | horizontal | spread | book
  direction: 'ltr',        // ltr | rtl
  zoom: 'page-width',      // page-width | page-fit | actual | percent
  zoomPercent: 100,
  theme: 'auto',           // auto | light | dark
  readBg: 'light',         // light | dark | sepia | slate | paper
  pageFilter: 'none',      // none | sepia | contrast | invert | dim
  gap: 14,
  showSidebar: true,
  sidebarTab: 'thumbs',    // thumbs | outline | bookmarks | annotations | info
  showToolbar: true,
  smoothScroll: true,
  restorePosition: true,
  pageNumbers: false
};

export const ZOOM_STEPS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

/** Keyboard shortcut defaults (editable in Settings). */
export const SHORTCUTS = {
  next: ['ArrowRight', 'ArrowDown', 'PageDown'],
  prev: ['ArrowLeft', 'ArrowUp', 'PageUp'],
  first: ['Home'],
  last: ['End'],
  search: ['ctrl+f', 'meta+f'],
  print: ['ctrl+p', 'meta+p'],
  save: ['ctrl+s', 'meta+s'],
  zoomIn: ['ctrl+=', 'ctrl++', 'meta+=', 'meta++'],
  zoomOut: ['ctrl+-', 'meta+-'],
  fitWidth: ['ctrl+0', 'meta+0'],
  fitPage: ['shift+ctrl+0'],
  escape: ['Escape'],
  sidebar: ['ctrl+b', 'meta+b'],
  fullscreen: ['f'],
  rotate: ['r'],
  zoomReset: ['ctrl+1'],
  pan: ['h'],
  toolSelect: ['v'],
  toolHighlight: ['s'],
  toolUnderline: ['u'],
  toolStrike: ['k'],
  toolPen: ['p'],
  toolMarker: ['m'],
  toolEraser: ['e'],
  toolText: ['t'],
  toolNote: ['n'],
  toolRect: ['b'],
  toolEllipse: ['o'],
  toolArrow: ['a'],
  toolLine: ['l'],
  toolImage: ['g'],
  toolSignature: ['i'],
  duplicate: ['ctrl+d', 'meta+d'],
  deleteSelected: ['Delete', 'Backspace']
};

export const ANNOTATION_TOOLS = [
  { id: 'select', label: 'Select', icon: 'move', hint: 'Select, move or delete annotations' },
  { id: 'highlight', label: 'Highlight', icon: 'highlighter', hint: 'Drag across text to highlight' },
  { id: 'underline', label: 'Underline', icon: 'underline', hint: 'Drag across text to underline' },
  { id: 'strike', label: 'Strike', icon: 'strike', hint: 'Drag across text to strike through' },
  { id: 'pen', label: 'Pen', icon: 'pen', hint: 'Freehand drawing' },
  { id: 'marker', label: 'Marker', icon: 'highlighter', hint: 'Wide translucent freehand' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser', hint: 'Click a stroke to erase it' },
  { id: 'text', label: 'Text', icon: 'type', hint: 'Click to place a text box' },
  { id: 'note', label: 'Note', icon: 'note', hint: 'Click to pin a sticky note' },
  { id: 'rect', label: 'Rectangle', icon: 'square', hint: 'Drag to draw a rectangle' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle', hint: 'Drag to draw an ellipse' },
  { id: 'arrow', label: 'Arrow', icon: 'arrow-shape', hint: 'Drag to draw an arrow' },
  { id: 'line', label: 'Line', icon: 'line', hint: 'Drag to draw a line' },
  { id: 'signature', label: 'Signature', icon: 'signature', hint: 'Draw and place a signature' },
  { id: 'image', label: 'Image', icon: 'image', hint: 'Place an image on the page' }
];

export const ANNOTATION_COLORS = [
  '#f2c744', '#f08c3a', '#e2574c', '#d94f9e', '#8a63d2',
  '#4f7ce8', '#2f9e8f', '#3f9e4d', '#1f2933', '#ffffff'
];

/** Embed parameter contract — single source of truth for parsing and the generator. */
export const EMBED_PARAMS = [
  { key: 'file', type: 'url', label: 'PDF URL', group: 'Source', desc: 'Absolute URL of the PDF to display. Required.' },
  { key: 'page', type: 'int', min: 1, label: 'Start page', group: 'Navigation', desc: 'Page to open on load.' },
  { key: 'zoom', type: 'enum', values: ['page-width', 'page-fit', 'actual', '50', '75', '100', '125', '150', '200'], label: 'Initial zoom', group: 'Navigation', desc: 'Zoom level applied on load.' },
  { key: 'fit', type: 'enum', values: ['width', 'page', 'auto'], label: 'Fit mode', group: 'Navigation', desc: 'Alias for zoom fitting behaviour.' },
  { key: 'toolbar', type: 'bool', label: 'Toolbar', group: 'Chrome', desc: 'Show the viewer toolbar.' },
  { key: 'sidebar', type: 'bool', label: 'Sidebar', group: 'Chrome', desc: 'Show the thumbnails/outline sidebar.' },
  { key: 'navigation', type: 'bool', label: 'Page navigation', group: 'Chrome', desc: 'Show page navigation controls.' },
  { key: 'search', type: 'bool', label: 'Search', group: 'Chrome', desc: 'Enable in-document search.' },
  { key: 'download', type: 'bool', label: 'Download', group: 'Chrome', desc: 'Show the download button.' },
  { key: 'print', type: 'bool', label: 'Print', group: 'Chrome', desc: 'Show the print button.' },
  { key: 'fullscreen', type: 'bool', label: 'Fullscreen', group: 'Chrome', desc: 'Show the fullscreen button.' },
  { key: 'controls', type: 'enum', values: ['auto', 'always', 'never'], label: 'Controls', group: 'Chrome', desc: 'When to reveal controls on touch devices.' },
  { key: 'mobileToolbar', type: 'bool', label: 'Mobile toolbar', group: 'Chrome', desc: 'Use the compact bottom bar on small screens.' },
  { key: 'theme', type: 'enum', values: ['light', 'dark', 'auto'], label: 'Theme', group: 'Appearance', desc: 'Colour theme of the viewer chrome.' },
  { key: 'background', type: 'enum', values: ['light', 'dark', 'sepia', 'slate', 'paper'], label: 'Background', group: 'Appearance', desc: 'Colour of the reading surface behind pages.' },
  { key: 'pageMode', type: 'enum', values: ['single', 'vertical', 'horizontal', 'spread', 'book'], label: 'Page mode', group: 'Appearance', desc: 'Layout of pages.' },
  { key: 'scroll', type: 'enum', values: ['vertical', 'horizontal'], label: 'Scroll axis', group: 'Appearance', desc: 'Shortcut for the page mode axis.' },
  { key: 'spread', type: 'bool', label: 'Two-page spread', group: 'Appearance', desc: 'Shortcut for two-page display.' },
  { key: 'direction', type: 'enum', values: ['ltr', 'rtl'], label: 'Direction', group: 'Appearance', desc: 'Reading direction for spreads.' },
  { key: 'language', type: 'string', label: 'Language', group: 'Appearance', desc: 'UI language tag (e.g. en, hi, ar).' },
  { key: 'annotations', type: 'bool', label: 'Annotations', group: 'Features', desc: 'Allow viewer-side annotation tools.' },
  { key: 'outline', type: 'bool', label: 'Outline panel', group: 'Features', desc: 'Show the document outline tab.' },
  { key: 'readonly', type: 'bool', label: 'Read only', group: 'Features', desc: 'Disable annotation editing and downloads.' },
  { key: 'minimal', type: 'bool', label: 'Minimal chrome', group: 'Chrome', desc: 'Strip branding and secondary controls.' },
  { key: 'hideLogo', type: 'bool', label: 'Hide logo', group: 'Chrome', desc: 'Hide the Luma PDF mark in the embed.' },
  { key: 'watermark', type: 'string', label: 'Watermark text', group: 'Features', desc: 'Faint text overlaid on every page.' }
];

export const EMBED_PRESETS = {
  minimal: { toolbar: 1, sidebar: 0, search: 0, download: 0, print: 0, fullscreen: 0, minimal: 1, hideLogo: 1, theme: 'light' },
  professional: { toolbar: 1, sidebar: 1, search: 1, download: 1, print: 1, fullscreen: 1, theme: 'light' },
  reading: { toolbar: 1, sidebar: 0, search: 1, download: 0, print: 0, fullscreen: 1, theme: 'light', background: 'paper' },
  dark: { toolbar: 1, sidebar: 1, search: 1, download: 1, print: 1, fullscreen: 1, theme: 'dark', background: 'dark' },
  mobile: { toolbar: 1, sidebar: 0, search: 1, download: 0, print: 0, fullscreen: 0, mobileToolbar: 1, theme: 'light' },
  docs: { toolbar: 1, sidebar: 1, outline: 1, search: 1, download: 0, print: 0, theme: 'light', pageMode: 'vertical' },
  presentation: { toolbar: 0, sidebar: 0, search: 0, download: 0, print: 0, fullscreen: 0, pageMode: 'single', zoom: 'page-fit', minimal: 1, hideLogo: 1 }
};

export const FILE_LIMITS = {
  warnSizeMB: 40,
  maxSizeMB: 400,
  maxPagesSoft: 1200,
  imageMaxSide: 4096
};

export const ALLOWED_REMOTE_PROTOCOLS = ['https:', 'http:'];
