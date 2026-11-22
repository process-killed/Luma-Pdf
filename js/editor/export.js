/**
 * Export: rebuild a new PDF from the editor model (page order, rotations, overlays).
 * Uses pdf-lib; the source documents are read, never modified.
 */
import { pdfLib, loadLibDoc, hexToRgb } from '../tools/pdf-utils.js';

const POSITIONS = {
  'top-left': (pw, ph, w, h, m) => ({ x: m, y: ph - h - m }),
  'top-center': (pw, ph, w, h, m) => ({ x: (pw - w) / 2, y: ph - h - m }),
  'top-right': (pw, ph, w, h, m) => ({ x: pw - w - m, y: ph - h - m }),
  'center': (pw, ph, w, h) => ({ x: (pw - w) / 2, y: (ph - h) / 2 }),
  'bottom-left': (pw, ph, w, h, m) => ({ x: m, y: m }),
  'bottom-center': (pw, ph, w, h, m) => ({ x: (pw - w) / 2, y: m }),
  'bottom-right': (pw, ph, w, h, m) => ({ x: pw - w - m, y: m })
};

export async function buildPdf(editor, { onProgress } = {}) {
  const { PDFDocument, StandardFonts, degrees } = pdfLib();
  const out = await PDFDocument.create();
  const libCache = new Map();

  const libFor = async (srcId) => {
    if (libCache.has(srcId)) return libCache.get(srcId);
    const src = editor.sources.get(srcId);
    if (!src) throw new Error('A source document is missing from this session.');
    const doc = await loadLibDoc(src.bytes);
    libCache.set(srcId, doc);
    return doc;
  };

  const fonts = {};
  const font = async (name = 'regular') => {
    if (fonts[name]) return fonts[name];
    fonts[name] = await out.embedFont(name === 'bold' ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    return fonts[name];
  };

  const total = editor.pages.length;
  const written = [];
  for (let i = 0; i < total; i++) {
    const pageRef = editor.pages[i];
    const srcDoc = await libFor(pageRef.srcId);
    const [copied] = await out.copyPages(srcDoc, [pageRef.index]);
    const baseRotation = copied.getRotation().angle || 0;
    copied.setRotation(degrees((baseRotation + (pageRef.rotation || 0)) % 360));
    out.addPage(copied);
    written.push(copied);
    onProgress?.((i + 1) / total * 0.8, `Copying page ${i + 1} of ${total}`);
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  // Overlays are applied to the freshly built pages.
  for (const overlay of editor.overlays) {
    const targets = overlay.pages === 'all'
      ? written.map((_, i) => i)
      : (overlay.pages || []).map((n) => n - 1).filter((i) => i >= 0 && i < written.length);

    if (overlay.kind === 'text') {
      const f = await font(overlay.bold ? 'bold' : 'regular');
      for (const idx of targets) {
        const page = written[idx];
        const { width: pw, height: ph } = page.getSize();
        const size = overlay.size || 14;
        const lines = wrap(overlay.text || '', f, size, Math.max(60, (overlay.maxWidth || pw - 96)));
        const blockH = lines.length * size * 1.35;
        const widest = Math.max(...lines.map((l) => f.widthOfTextAtSize(l, size)), 1);
        const pos = (POSITIONS[overlay.position] || POSITIONS['top-left'])(pw, ph, widest, blockH, overlay.margin ?? 36);
        let y = pos.y + blockH - size;
        if (overlay.background) {
          page.drawRectangle({
            x: pos.x - 6, y: pos.y - 6, width: widest + 12, height: blockH + 12,
            color: hexToRgb(overlay.background), opacity: 0.92
          });
        }
        for (const line of lines) {
          page.drawText(line, { x: pos.x, y, size, font: f, color: hexToRgb(overlay.color || '#111111') });
          y -= size * 1.35;
        }
      }
    } else if (overlay.kind === 'image' && overlay.dataUrl) {
      let image;
      if (/^data:image\/png/i.test(overlay.dataUrl)) image = await out.embedPng(overlay.dataUrl);
      else if (/^data:image\/jpe?g/i.test(overlay.dataUrl)) image = await out.embedJpg(overlay.dataUrl);
      else {
        const converted = await toPng(overlay.dataUrl);
        image = await out.embedPng(converted);
      }
      for (const idx of targets) {
        const page = written[idx];
        const { width: pw, height: ph } = page.getSize();
        const w = Math.min(overlay.width || 160, pw - 40);
        const h = w * (image.height / image.width);
        const pos = (POSITIONS[overlay.position] || POSITIONS['center'])(pw, ph, w, h, overlay.margin ?? 32);
        page.drawImage(image, { x: pos.x, y: pos.y, width: w, height: h, opacity: overlay.opacity ?? 1 });
      }
    } else if (overlay.kind === 'watermark') {
      const f = await font('bold');
      for (const idx of targets) {
        const page = written[idx];
        const { width: pw, height: ph } = page.getSize();
        const size = overlay.size || 48;
        const text = overlay.text || 'DRAFT';
        const w = f.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: (pw - w) / 2, y: ph / 2 - size / 3, size, font: f,
          color: hexToRgb(overlay.color || '#8b8b9a'),
          opacity: Math.max(0.02, Math.min(1, (overlay.opacity ?? 14) / 100)),
          rotate: degrees(overlay.angle ?? 45)
        });
      }
    } else if (overlay.kind === 'pageNumbers') {
      const f = await font('regular');
      for (const idx of targets) {
        const page = written[idx];
        const { width: pw, height: ph } = page.getSize();
        const size = overlay.size || 10;
        const n = idx + 1;
        const label = (overlay.format || '{n} / {total}').replace('{n}', n).replace('{total}', written.length);
        const w = f.widthOfTextAtSize(label, size);
        const pos = (POSITIONS[overlay.position] || POSITIONS['bottom-center'])(pw, ph, w, size, overlay.margin ?? 28);
        page.drawText(label, { x: pos.x, y: pos.y, size, font: f, color: hexToRgb(overlay.color || '#55555f') });
      }
    }
    onProgress?.(0.85, 'Applying overlays');
  }

  out.setProducer('Luma PDF');
  out.setCreator('Luma PDF (browser)');
  out.setTitle((editor.name || 'document').replace(/\.pdf$/i, '') + ' (edited)');
  onProgress?.(0.95, 'Writing the PDF');
  const bytes = await out.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

function wrap(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      line = word;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

async function toPng(dataUrl) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
