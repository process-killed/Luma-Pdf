// Shared helpers for every PDF tool.
import { openFromBytes, renderPageOffscreen, pageText, getOutline, getDocumentInfo } from '../viewer/pdf-engine.js';
import { canEncodeImage, loadImage, readAsDataURL } from '../utils/files.js';

export function pdfLib() {
  if (!window.PDFLib) throw new Error('The PDF library (pdf-lib) did not load. Reload the page and try again.');
  return window.PDFLib;
}

export async function loadLibDoc(bytes) {
  const { PDFDocument } = pdfLib();
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (err) {
    if (/encrypt/i.test(err?.message || '')) {
      throw new Error('This PDF is encrypted. Remove the password (for example with your PDF reader) before using this tool.');
    }
    throw new Error('This file could not be read as a PDF: ' + (err?.message || 'unknown error'));
  }
}

export async function bytesOf(file) {
  return new Uint8Array(await file.arrayBuffer());
}

/** Open with PDF.js (for rendering, text and metadata). */
export async function openForRender(file, opts = {}) {
  const bytes = await bytesOf(file);
  const doc = await openFromBytes(bytes, opts);
  return { doc, bytes };
}

export function parsePageSpec(spec, total, { defaultAll = true } = {}) {
  const text = String(spec ?? '').trim();
  if (!text) {
    if (!defaultAll) return [];
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const set = new Set();
  text.split(',').forEach((part) => {
    const bit = part.trim();
    if (!bit) return;
    const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(bit);
    if (m) {
      const a = Math.max(1, Number(m[1])), b = Math.min(total, Number(m[2]));
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
    } else if (/^\d+$/.test(bit)) {
      const n = Number(bit);
      if (n >= 1 && n <= total) set.add(n);
    }
  });
  return Array.from(set).sort((a, b) => a - b);
}

export function hexToRgb(hex) {
  const { rgb } = pdfLib();
  const clean = String(hex || '#000000').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return rgb(0, 0, 0);
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

export async function canvasToJpegBytes(canvas, quality = 0.8) {
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Canvas export failed'))), 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function imageBlobFor(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed.'))), type, quality);
  });
}

/** Render selected pages to JPEG bytes + canvas for PDF rebuilding. */
export async function renderPages(doc, pages, { scale = 2, onProgress, quality = 0.85, maxPixels = 12_000_000 } = {}) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const num = pages[i];
    const page = await doc.getPage(num);
    const canvas = await renderPageOffscreen(page, { scale, maxPixels });
    out.push({ page: num, canvas, jpeg: await canvasToJpegBytes(canvas, quality), width: canvas.width, height: canvas.height });
    onProgress?.((i + 1) / pages.length, `Page ${num} of ${pages[pages.length - 1]}`);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

export function detectImageType(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif';
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  return null;
}

/** Embed any browser-decodable image into a pdf-lib document (converts to PNG if needed). */
export async function embedAnyImage(pdfDoc, file) {
  const bytes = await bytesOf(file);
  const type = detectImageType(bytes);
  if (type === 'png') return { image: await pdfDoc.embedPng(bytes), width: 0, height: 0 };
  if (type === 'jpg') return { image: await pdfDoc.embedJpg(bytes), width: 0, height: 0 };
  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const png = await imageBlobFor(canvas, 'image/png');
  return { image: await pdfDoc.embedPng(new Uint8Array(await png.arrayBuffer())), width: canvas.width, height: canvas.height };
}

export const PAGE_SIZES = {
  a4: { w: 595.28, h: 841.89, label: 'A4 (210 × 297 mm)' },
  letter: { w: 612, h: 792, label: 'US Letter (8.5 × 11 in)' },
  legal: { w: 612, h: 1008, label: 'US Legal (8.5 × 14 in)' },
  a3: { w: 841.89, h: 1190.55, label: 'A3 (297 × 420 mm)' },
  a5: { w: 419.53, h: 595.28, label: 'A5 (148 × 210 mm)' }
};

export function pdfVersionFromBytes(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 16));
  const m = /^%PDF-(\d\.\d)/.exec(head);
  return m ? m[1] : null;
}

export async function pdfInfoFor(file) {
  const { doc, bytes } = await openForRender(file);
  const info = await getDocumentInfo(doc);
  let outline = [];
  try { outline = await getOutline(doc); } catch { outline = []; }
  const dims = [];
  const limit = Math.min(doc.numPages, 25);
  for (let i = 1; i <= limit; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    dims.push({ page: i, width: Math.round(vp.width), height: Math.round(vp.height) });
  }
  return { doc, bytes, info, outline, dims, version: pdfVersionFromBytes(bytes), size: file.size, name: file.name };
}

export function textOfOutline(outline, depth = 0) {
  return outline.map((item) => {
    const line = `${'  '.repeat(depth)}${item.title}${item.page ? `  (p. ${item.page})` : ''}`;
    return [line, ...textOfOutline(item.children || [], depth + 1)].join('\n');
  }).join('\n');
}

export async function allPageText(doc, { markers = true, onProgress } = {}) {
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = await pageText(page);
    page.cleanup();
    parts.push(markers ? `===== Page ${i} =====\n${text || '(no extractable text)'}` : text);
    onProgress?.(i / doc.numPages, `Page ${i} of ${doc.numPages}`);
    await new Promise((r) => setTimeout(r, 0));
  }
  return parts.join('\n\n');
}

export function canEncode(type) { return canEncodeImage(type); }
