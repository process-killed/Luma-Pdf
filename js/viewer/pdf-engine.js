/**
 * PDF engine — thin, careful wrapper around PDF.js.
 * Handles worker wiring, opening documents from files/URLs/bytes, page rendering
 * and turning library errors into messages a user can act on.
 */

const VENDOR = new URL('../../vendor/pdfjs/', import.meta.url);
const WORKER_URL = new URL('pdf.worker.min.js', VENDOR).href;

import { mark } from '../utils/marks.js';

let readyPromise = null;

/** Boot the PDF.js worker before a document is even chosen. */
export function warmWorker() {
  return engineReady().then((lib) => {
    try {
      if (!lib.__lumaWarm && typeof lib.PDFWorker === 'function') {
        lib.__lumaWarm = new lib.PDFWorker({ name: 'luma-warm' });
      }
    } catch { /* the worker is optional; getDocument starts one anyway */ }
  }).catch(() => {});
}

export function engineReady() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.pdfjsLib) {
        const lib = window.pdfjsLib;
        lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
        resolve(lib);
        return;
      }
      if (Date.now() - start > 15000) {
        reject(new Error('The PDF engine (PDF.js) did not load. Check that vendor/pdfjs/pdf.min.js is deployed and reachable.'));
        return;
      }
      setTimeout(check, 40);
    };
    check();
  });
  return readyPromise;
}

export function engineConfig() {
  return {
    cMapUrl: new URL('cmaps/', VENDOR).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', VENDOR).href,
    isEvalSupported: false,        // never evaluate PDF-supplied content
    disableAutoFetch: false,
    disableStream: false,
    enableXfa: true
  };
}

/** Open a PDF from an ArrayBuffer / Uint8Array. */
export async function openFromBytes(bytes, { onProgress, password } = {}) {
  const lib = await engineReady();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const task = lib.getDocument({
    data: data.slice ? data.slice(0) : data,
    ...engineConfig(),
    password: password || undefined
  });
  if (onProgress && task.onProgress) {
    task.onProgress = ({ loaded, total }) => onProgress(total ? loaded / total : 0, loaded, total);
  }
  const doc = await task.promise;
  doc.__task = task;
  return doc;
}

/** Open a File or Blob. */
export async function openFromFile(file, opts = {}) {
  const buffer = await file.arrayBuffer();
  const doc = await openFromBytes(buffer, opts);
  doc.__source = { kind: 'file', name: file.name, size: file.size };
  return doc;
}

/**
 * Open a remote PDF. Uses PDF.js range requests when the server supports them.
 * CORS failures are reported explicitly rather than as a generic error.
 */
/**
 * Fetch the bytes ourselves and hand them to PDF.js.
 *
 * Two reasons: the download then starts at the same moment the worker boots instead of
 * after it, and progress reporting works in every browser (PDF.js only reports it in
 * some). Very large files fall back to PDF.js's own streaming loader.
 */
async function fetchBytes(url, onProgress) {
  mark('pdf-fetch');
  const res = await fetch(url, { credentials: 'same-origin', mode: 'cors' });
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}`);
    error.name = res.status === 404 ? 'MissingPDFException' : 'UnexpectedResponseException';
    throw error;
  }
  const type = res.headers.get('content-type') || '';
  const total = Number(res.headers.get('content-length') || 0);
  if (total > 120 * 1024 * 1024) return null;      // let PDF.js stream it instead
  if (!res.body || !res.body.getReader) {
    const buffer = await res.arrayBuffer();
    onProgress?.(1, buffer.byteLength, buffer.byteLength);
    return new Uint8Array(buffer);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(total ? loaded / total : 0.5, loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!bytes.length || (type && !/pdf|octet-stream/i.test(type))) {
    const error = new Error('Not a PDF');
    error.name = 'InvalidPDFException';
    throw error;
  }
  onProgress?.(1, loaded, loaded);
  mark('pdf-bytes');
  return bytes;
}

export async function openFromUrl(url, { onProgress, password } = {}) {
  const lib = await engineReady();
  let bytes = null;
  try {
    bytes = await fetchBytes(url, onProgress);
  } catch (err) {
    // CORS or a network failure: let PDF.js try with its own loader so its error
    // message (and its retry behaviour) is what the user sees.
    if (!/HTTP|Not a PDF/.test(err.message)) bytes = null;
    else throw enrichError(err, { url });
  }
  try {
    const task = bytes
      ? lib.getDocument({ data: bytes, ...engineConfig(), worker: lib.__lumaWarm, password: password || undefined })
      : lib.getDocument({ url, ...engineConfig(), worker: lib.__lumaWarm, withCredentials: false, password: password || undefined });
    mark('pdf-parse-start');
    const doc = await task.promise;
    mark('pdf-parsed');
    doc.__task = task;
    doc.__source = { kind: 'url', url, bytes };
    return doc;
  } catch (err) {
    throw enrichError(err, { url });
  }
}

export async function renderPageToCanvas(page, canvas, { scale = 1, outputScale = 1, rotation = 0, intent = 'display' } = {}) {
  const viewport = page.getViewport({ scale, rotation });
  const targetW = Math.max(1, Math.floor(viewport.width * outputScale));
  const targetH = Math.max(1, Math.floor(viewport.height * outputScale));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.restore();
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
  const renderTask = page.render({ canvasContext: ctx, viewport, transform, intent });
  await renderTask.promise;
  return { viewport, renderTask };
}

/** Render a page to an offscreen canvas and return it (used by tools). */
export async function renderPageOffscreen(page, { scale = 1.5, maxPixels = 8_000_000 } = {}) {
  const base = page.getViewport({ scale: 1 });
  let s = scale;
  if (base.width * base.height * s * s > maxPixels) s = Math.sqrt(maxPixels / (base.width * base.height));
  const viewport = page.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 'print' intent keeps this render from cancelling a live viewer render of the same page.
  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
  return canvas;
}

/** Plain text of one page, in reading order as PDF.js reports it. */
export async function pageText(page) {
  const content = await page.getTextContent();
  let out = '';
  let lastY = null;
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform ? Math.round(item.transform[5]) : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) out += '\n';
    else if (out && !out.endsWith(' ') && item.str && !item.str.startsWith(' ')) out += ' ';
    out += item.str;
    if (item.hasEOL) out += '\n';
    lastY = y;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function documentText(doc, { from = 1, to = doc.numPages, onProgress } = {}) {
  const pages = [];
  for (let i = from; i <= to; i++) {
    const page = await doc.getPage(i);
    pages.push(await pageText(page));
    page.cleanup();
    onProgress?.(i, to);
  }
  return pages;
}

/** Flatten the PDF outline into a navigable tree with page numbers. */
export async function getOutline(doc) {
  let outline;
  try { outline = await doc.getOutline(); } catch { return []; }
  if (!outline || !outline.length) return [];

  const resolveDest = async (dest) => {
    try {
      let explicit = dest;
      if (typeof dest === 'string') explicit = await doc.getDestination(dest);
      if (!Array.isArray(explicit)) return null;
      const ref = explicit[0];
      if (typeof ref === 'number') return ref + 1;
      if (ref && typeof ref === 'object') {
        const idx = await doc.getPageIndex(ref);
        return idx + 1;
      }
    } catch { /* ignore */ }
    return null;
  };

  const walk = async (items, depth = 0) => {
    const out = [];
    for (const item of items) {
      out.push({
        title: String(item.title || 'Untitled').trim() || 'Untitled',
        page: await resolveDest(item.dest),
        depth,
        children: item.items && item.items.length ? await walk(item.items, depth + 1) : []
      });
    }
    return out;
  };
  return walk(outline);
}

export async function getDocumentInfo(doc) {
  let meta = {};
  try {
    const m = await doc.getMetadata();
    meta = m?.info || {};
  } catch { /* ignore */ }
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  page.cleanup();
  return {
    title: meta.Title || '',
    author: meta.Author || '',
    subject: meta.Subject || '',
    keywords: meta.Keywords || '',
    creator: meta.Creator || '',
    producer: meta.Producer || '',
    creationDate: parsePdfDate(meta.CreationDate),
    modDate: parsePdfDate(meta.ModDate),
    pages: doc.numPages,
    fingerprints: doc.fingerprints || [],
    firstPageSize: { width: Math.round(vp.width), height: Math.round(vp.height) }
  };
}

function parsePdfDate(raw) {
  if (!raw) return '';
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(String(raw));
  if (!m) return String(raw);
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m;
  return `${d}/${mo}/${y} ${h}:${mi}:${s}`;
}

/** Add context to a PDF.js error so the UI can explain it. */
export function enrichError(err, ctx = {}) {
  const name = err?.name || '';
  const message = err?.message || String(err);
  if (name === 'PasswordException' || /password/i.test(message)) {
    return Object.assign(new Error('This PDF is password protected. Enter the password to open it.'), {
      code: 'PASSWORD_REQUIRED', name: 'PasswordException', cause: err
    });
  }
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) {
    return Object.assign(new Error('This file is not a valid PDF, or it is damaged.'), { code: 'INVALID_PDF', cause: err });
  }
  if (/fetch|network|cors|failed to fetch|load failed/i.test(message)) {
    return Object.assign(new Error(
      `The PDF could not be downloaded from ${ctx.url || 'that address'}. ` +
      'The server must send Access-Control-Allow-Origin for this site, and the link must be public and reachable.'
    ), { code: 'NETWORK_CORS', cause: err });
  }
  if (name === 'MissingPDFException') {
    return Object.assign(new Error('That address did not return a PDF (404 or the wrong content type).'), { code: 'NOT_PDF', cause: err });
  }
  return err;
}

export function errorCode(err) {
  if (!err) return 'UNKNOWN';
  if (err.code) return err.code;
  if (err.name === 'PasswordException') return 'PASSWORD_REQUIRED';
  if (err.name === 'InvalidPDFException') return 'INVALID_PDF';
  if (err.name === 'MissingPDFException') return 'NOT_PDF';
  return 'UNKNOWN';
}
