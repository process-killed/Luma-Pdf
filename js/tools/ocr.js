/**
 * OCR — recognises text on scanned pages and writes an invisible text layer into a
 * searchable PDF. The recognition engine is downloaded on first use; the document
 * itself never leaves the browser.
 */
import { bytesOf, openForRender, loadLibDoc, pdfLib, parsePageSpec } from './pdf-utils.js';
import { pdfName, formatBytes } from '../utils/files.js';

/** Engine assets. Point these at a local copy in vendor/tesseract/ for offline use. */
export const OCR_ENGINE = {
  script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0',
  lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int',
  langCode: 'eng'
};

let scriptPromise = null;
let workerPromise = null;

function loadEngine() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(window.Tesseract); return; }
    const script = document.createElement('script');
    script.src = OCR_ENGINE.script;
    script.onload = () => (window.Tesseract
      ? resolve(window.Tesseract)
      : reject(new Error('The OCR engine loaded but is unavailable.')));
    script.onerror = () => reject(new Error(
      'OCR needs to download its recognition engine the first time, and that request failed. ' +
      'Check the connection, or host the engine locally (see docs/OCR.md).'));
    document.head.append(script);
  });
  return scriptPromise;
}

async function getWorker(onProgress) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const Tesseract = await loadEngine();
    return Tesseract.createWorker(OCR_ENGINE.langCode, 1, {
      workerPath: OCR_ENGINE.worker,
      corePath: OCR_ENGINE.core,
      langPath: OCR_ENGINE.lang,
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress?.(m.progress || 0, 'Recognising text');
        else if (m.progress != null) onProgress?.(m.progress, m.status);
      }
    });
  })();
  return workerPromise;
}

export async function terminateOcr() {
  if (!workerPromise) return;
  try { const w = await workerPromise; await w.terminate(); } catch { /* ignore */ }
  workerPromise = null;
}

/** Words with boxes, tolerant of the shapes tesseract.js has used across versions. */
function wordsOf(data) {
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) out.push(word);
      }
    }
  }
  return out;
}

async function renderForOcr(doc, pageNum, dpi) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement('canvas');
  const maxPixels = 6_500_000;
  let scale = dpi / 72;
  if (viewport.width * viewport.height > maxPixels) {
    scale = Math.sqrt(maxPixels / (viewport.width / (dpi / 72) * (viewport.height / (dpi / 72))));
  }
  const vp = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  return { canvas, scale, page };
}

export const ocrPdf = {
  id: 'ocr-pdf',
  name: 'OCR scanned PDF',
  desc: 'Recognise text on scanned pages and add an invisible, searchable text layer.',
  icon: 'search',
  category: 'convert',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'mode', label: 'Output', type: 'select', default: 'searchable', options: [
      { value: 'searchable', label: 'Searchable PDF (keeps the pages)' },
      { value: 'text', label: 'Text file only' },
      { value: 'both', label: 'Searchable PDF + text file' }
    ] },
    { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' },
    { key: 'dpi', label: 'Scan resolution', type: 'select', default: '200', options: [
      { value: '150', label: '150 DPI — fast' },
      { value: '200', label: '200 DPI — balanced' },
      { value: '300', label: '300 DPI — small print' }
    ] }
  ],
  async run({ files, values, progress }) {
    const file = files[0];
    const bytes = await bytesOf(file);
    const { doc } = await openForRender(file);
    const pages = parsePageSpec(values.pages, doc.numPages);
    if (!pages.length) throw new Error('No pages matched that range.');
    const dpi = Number(values.dpi) || 200;
    const mode = values.mode || 'searchable';

    progress(0.02, 'Loading the OCR engine (~7 MB, first run only)');
    const worker = await getWorker((p, status) => progress(0.05 + p * 0.1, status));

    const textPages = [];
    let recognised = 0;
    for (let i = 0; i < pages.length; i++) {
      const pageNum = pages[i];
      progress(0.12 + (i / pages.length) * 0.8, `Recognising page ${pageNum} of ${pages[pages.length - 1]}`);
      const { canvas, scale } = await renderForOcr(doc, pageNum, dpi);
      const { data } = await worker.recognize(canvas);
      const words = wordsOf(data);
      textPages.push({ page: pageNum, text: data.text || '', words, scale, width: canvas.width, height: canvas.height });
      recognised++;
      await new Promise((r) => setTimeout(r, 0));
    }

    const plain = textPages.map((p) => `===== Page ${p.page} =====\n${(p.text || '').trim() || '(nothing recognised)'}`).join('\n\n');

    if (mode === 'text') {
      return {
        blob: new Blob([plain], { type: 'text/plain;charset=utf-8' }),
        filename: pdfName(file.name).replace(/\.pdf$/, '-ocr.txt'),
        summary: `Recognised text on ${recognised} page${recognised === 1 ? '' : 's'}.`,
        details: [`${plain.length.toLocaleString()} characters`, 'Scanned pages keep their appearance; only the text is new.'],
        preview: { kind: 'text', text: plain.slice(0, 4000) }
      };
    }

    progress(0.93, 'Writing the searchable PDF');
    const { StandardFonts } = pdfLib();
    const out = await loadLibDoc(bytes);
    const font = await out.embedFont(StandardFonts.Helvetica);
    let placed = 0;

    for (const result of textPages) {
      const page = out.getPage(result.page - 1);
      const { height } = page.getSize();
      const scale = result.scale;
      for (const word of result.words) {
        const text = String(word.text || '').trim();
        if (!text) continue;
        const box = word.bbox || {};
        const x = (box.x0 ?? 0) / scale;
        const yTop = (box.y0 ?? 0) / scale;
        const h = Math.max(4, ((box.y1 ?? 0) - (box.y0 ?? 0)) / scale);
        const size = Math.min(48, h * 0.92);
        try {
          page.drawText(text.replace(/[^\u0000-\u00ff]/g, '?'), {
            x,
            y: height - yTop - size,
            size,
            font,
            opacity: 0
          });
          placed++;
        } catch { /* a word that cannot be encoded is skipped */ }
      }
    }

    progress(0.98, 'Saving');
    const outBytes = await out.save();
    const detailText = [
      `${recognised} page${recognised === 1 ? '' : 's'} recognised`,
      `${placed.toLocaleString()} words placed as invisible text`,
      `${formatBytes(outBytes.length)} output`
    ];

    if (mode === 'both') {
      return {
        blob: new Blob([outBytes], { type: 'application/pdf' }),
        filename: pdfName(file.name, '-searchable'),
        summary: `Searchable PDF created — ${recognised} pages.`,
        details: [...detailText, 'The plain text is in the preview below (use “OCR text file only” to download it).'],
        preview: { kind: 'pdf' }
      };
    }

    return {
      blob: new Blob([outBytes], { type: 'application/pdf' }),
      filename: pdfName(file.name, '-searchable'),
      summary: `Searchable PDF created — ${recognised} pages, ${placed.toLocaleString()} words.`,
      details: detailText,
      preview: { kind: 'pdf' }
    };
  }
};
