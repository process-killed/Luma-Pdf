/**
 * Lazy loader for pdf-lib.
 *
 * pdf-lib is half a megabyte of JavaScript and is only needed for editing (forms,
 * export, page operations). Parsing and compiling it on a phone costs more than the
 * first page render, so the viewer loads it on demand instead of on every open.
 */
let promise = null;

export function pdfLibLoaded() {
  return typeof window.PDFLib !== 'undefined';
}

export function loadPdfLib() {
  if (promise) return promise;
  if (window.PDFLib) { promise = Promise.resolve(window.PDFLib); return promise; }
  promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../../vendor/pdf-lib/pdf-lib.min.js', import.meta.url).href;
    script.async = true;
    script.onload = () => (window.PDFLib
      ? resolve(window.PDFLib)
      : reject(new Error('pdf-lib loaded but did not register itself.')));
    script.onerror = () => reject(new Error('pdf-lib could not be loaded. Check vendor/pdf-lib/.'));
    document.head.append(script);
  });
  return promise;
}

/** Warm the script in the background without blocking anything. */
export function prefetchPdfLib() {
  const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  schedule(() => { loadPdfLib().catch(() => {}); }, { timeout: 4000 });
}
