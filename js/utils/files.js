// File, blob and canvas helpers.
import { FILE_LIMITS } from '../config.js';

export function formatBytes(bytes, digits = 1) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(v >= 100 ? 0 : digits) + ' ' + units[i];
}

export function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

export const isPdfFile = (file) => !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));

export function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Could not read the file.'));
    fr.readAsArrayBuffer(file);
  });
}

export function readAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Could not read the file.'));
    fr.readAsText(file);
  });
}

export function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Could not read the file.'));
    fr.readAsDataURL(blob);
  });
}

export function sanitizeFilename(name, fallback = 'document') {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop();
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned || fallback;
}

export function pdfName(name, suffix = '') {
  const clean = sanitizeFilename(name || 'document.pdf', 'document.pdf');
  const stem = clean.replace(/\.pdf$/i, '');
  return `${stem}${suffix}.pdf`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

export function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type }), filename);
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed.'))), type, quality);
    } else {
      try {
        const data = canvas.toDataURL(type, quality);
        const [head, b64] = data.split(',');
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: head.match(/:(.*?);/)[1] }));
      } catch (e) { reject(e); }
    }
  });
}

/** Returns true when the browser can encode this image type. */
export function canEncodeImage(type) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL(type).startsWith('data:' + type);
  } catch { return false; }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded.'));
    img.src = src;
  });
}

export function fileToImage(file) {
  return readAsDataURL(file).then(loadImage);
}

/** Guard against absurd file sizes before we start reading. */
export function checkFileSize(file) {
  const mb = file.size / (1024 * 1024);
  if (mb > FILE_LIMITS.maxSizeMB) {
    throw new Error(`This file is ${mb.toFixed(0)} MB. Luma PDF works in memory, so files above ${FILE_LIMITS.maxSizeMB} MB are not supported in the browser.`);
  }
  return { mb, warn: mb > FILE_LIMITS.warnSizeMB };
}

export function uid(prefix = 'id') {
  return prefix + '-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function bytesToText(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}
