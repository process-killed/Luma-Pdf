// Conversion tools: PDF → images, images → PDF, text both ways.
import { loadLibDoc, bytesOf, pdfLib, openForRender, renderPages, imageBlobFor, allPageText, PAGE_SIZES, canEncode } from './pdf-utils.js';
import { createZip } from '../utils/zip.js';
import { pdfName, readAsText, loadImage, readAsDataURL, canEncodeImage } from '../utils/files.js';

function imageTool({ id, name, desc, type, label, ext, quality }) {
  return {
    id,
    name,
    desc,
    icon: 'image',
    category: 'convert',
    inputs: { files: 'pdf', multiple: false },
    params: [
      { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' },
      { key: 'dpi', label: 'Resolution', type: 'select', default: '150', options: [
        { value: '72', label: '72 DPI — screen draft' },
        { value: '150', label: '150 DPI — standard' },
        { value: '200', label: '200 DPI — sharp' },
        { value: '300', label: '300 DPI — print' }
      ] }
    ],
    async run({ files, values, progress }) {
      if (type === 'image/webp' && !canEncodeImage('image/webp')) {
        throw new Error('This browser cannot encode WebP images. Use the PNG or JPG tool instead.');
      }
      const { doc } = await openForRender(files[0]);
      const total = doc.numPages;
      const { parsePageSpec } = await import('./pdf-utils.js');
      const pages = parsePageSpec(values.pages, total);
      if (!pages.length) throw new Error('No pages matched that range.');
      const dpi = Number(values.dpi) || 150;
      const scale = dpi / 72;
      const rendered = await renderPages(doc, pages, {
        scale,
        quality,
        onProgress: (r, m) => progress(0.1 + r * 0.85, m)
      });
      const blobs = [];
      for (const item of rendered) {
        const blob = await imageBlobFor(item.canvas, type, quality);
        blobs.push({ name: `page-${String(item.page).padStart(3, '0')}.${ext}`, blob });
      }
      progress(0.97, 'Packaging images');
      if (blobs.length === 1) {
        return {
          blob: blobs[0].blob,
          filename: pdfName(files[0].name).replace(/\.pdf$/, `-page-${pages[0]}.${ext}`),
          summary: `Exported 1 ${label} image at ${dpi} DPI.`,
          details: [`Page ${pages[0]} · ${rendered[0].width} × ${rendered[0].height} px`],
          preview: { kind: 'image', blob: blobs[0].blob }
        };
      }
      return {
        blob: createZip(blobs.map((b) => ({ name: b.name, data: b.blob }))),
        filename: pdfName(files[0].name).replace(/\.pdf$/, `-${ext}`) + '.zip',
        summary: `Exported ${blobs.length} ${label} images at ${dpi} DPI in a ZIP archive.`,
        details: blobs.map((b) => b.name),
        preview: { kind: 'list', items: blobs.map((b) => ({ name: b.name, size: b.blob.size })) }
      };
    }
  };
}

export const pdfToJpg = imageTool({ id: 'pdf-to-jpg', name: 'PDF to JPG', desc: 'Render pages as JPEG images, one file per page.', type: 'image/jpeg', label: 'JPEG', ext: 'jpg', quality: 0.88 });
export const pdfToPng = imageTool({ id: 'pdf-to-png', name: 'PDF to PNG', desc: 'Render pages as lossless PNG images.', type: 'image/png', label: 'PNG', ext: 'png', quality: 1 });
export const pdfToWebp = imageTool({ id: 'pdf-to-webp', name: 'PDF to WebP', desc: 'Render pages as WebP images (smaller files, Chrome/Edge/Firefox).', type: 'image/webp', label: 'WebP', ext: 'webp', quality: 0.85 });

export const pdfToPrintImages = {
  id: 'pdf-to-print-images',
  name: 'PDF to print images',
  desc: 'High-resolution PNGs at print DPI, ready for a print shop.',
  icon: 'printer',
  category: 'convert',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'dpi', label: 'Print resolution', type: 'select', default: '300', options: [
      { value: '200', label: '200 DPI' },
      { value: '300', label: '300 DPI — recommended' },
      { value: '400', label: '400 DPI — large files' }
    ] },
    { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' }
  ],
  async run({ files, values, progress }) {
    const { doc } = await openForRender(files[0]);
    const { parsePageSpec } = await import('./pdf-utils.js');
    const pages = parsePageSpec(values.pages, doc.numPages);
    const dpi = Number(values.dpi) || 300;
    const rendered = await renderPages(doc, pages, {
      scale: dpi / 72,
      quality: 0.95,
      maxPixels: 24_000_000,
      onProgress: (r, m) => progress(0.1 + r * 0.85, m)
    });
    const entries = [];
    for (const item of rendered) {
      const blob = await imageBlobFor(item.canvas, 'image/png', 1);
      entries.push({ name: `page-${String(item.page).padStart(3, '0')}-${dpi}dpi.png`, data: blob });
    }
    const largest = Math.max(...rendered.map((r) => r.width * r.height));
    return {
      blob: createZip(entries.map((e) => ({ name: e.name, data: e.data }))),
      filename: pdfName(files[0].name).replace(/\.pdf$/, `-print-${dpi}dpi`) + '.zip',
      summary: `${entries.length} print-ready PNGs at ${dpi} DPI.`,
      details: [`Largest page: ${largest.toLocaleString()} pixels`, 'Files are uncompressed PNG — expect large archives.'],
      preview: { kind: 'list', items: entries.map((e) => ({ name: e.name, size: e.data.size })) }
    };
  }
};

export const imagesToPdf = {
  id: 'images-to-pdf',
  name: 'Images to PDF',
  desc: 'Combine JPG, PNG, WebP or GIF images into a single PDF.',
  icon: 'file-plus',
  category: 'convert',
  inputs: { files: 'image', multiple: true, min: 1 },
  params: [
    { key: 'pageSize', label: 'Page size', type: 'select', default: 'fit', options: [
      { value: 'fit', label: 'Fit to each image' },
      ...Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.label }))
    ] },
    { key: 'margin', label: 'Margin (pt)', type: 'number', default: 0, min: 0, max: 120 },
    { key: 'orientation', label: 'Orientation', type: 'select', default: 'auto', options: [
      { value: 'auto', label: 'Match each image' },
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' }
    ] }
  ],
  async run({ files, values, progress }) {
    const { PDFDocument } = pdfLib();
    const out = await PDFDocument.create();
    const margin = Math.max(0, Number(values.margin) || 0);
    for (let i = 0; i < files.length; i++) {
      progress((i + 0.2) / files.length, `Adding ${files[i].name}`);
      const file = files[i];
      const bytes = await bytesOf(file);
      let image;
      try {
        if (/png$/i.test(file.type) || (bytes[0] === 0x89 && bytes[1] === 0x50)) image = await out.embedPng(bytes);
        else if (/jpe?g$/i.test(file.type) || (bytes[0] === 0xff && bytes[1] === 0xd8)) image = await out.embedJpg(bytes);
        else throw new Error('needs conversion');
      } catch {
        const dataUrl = await readAsDataURL(file);
        const img = await loadImage(dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const png = await imageBlobFor(canvas, 'image/png');
        image = await out.embedPng(new Uint8Array(await png.arrayBuffer()));
      }
      const iw = image.width;
      const ih = image.height;
      let pw, ph;
      if (values.pageSize === 'fit') {
        pw = iw + margin * 2;
        ph = ih + margin * 2;
      } else {
        const target = PAGE_SIZES[values.pageSize] || PAGE_SIZES.a4;
        const landscape = values.orientation === 'landscape' || (values.orientation === 'auto' && iw > ih);
        pw = landscape ? target.h : target.w;
        ph = landscape ? target.w : target.h;
      }
      const page = out.addPage([pw, ph]);
      const scale = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih);
      page.drawImage(image, {
        x: (pw - iw * scale) / 2,
        y: (ph - ih * scale) / 2,
        width: iw * scale,
        height: ih * scale
      });
      await new Promise((r) => setTimeout(r, 0));
    }
    progress(0.95, 'Writing the PDF');
    const bytes = await out.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName('images', `-${files.length}-images`),
      summary: `Created a ${files.length}-page PDF from images.`,
      details: files.map((f) => f.name),
      preview: { kind: 'pdf' }
    };
  }
};

export const pdfToText = {
  id: 'pdf-to-text',
  name: 'PDF to text',
  desc: 'Extract the real text layer into a plain .txt file.',
  icon: 'file-text',
  category: 'convert',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'markers', label: 'Include page markers', type: 'checkbox', default: true }
  ],
  async run({ files, values, progress }) {
    const { doc } = await openForRender(files[0]);
    const text = await allPageText(doc, {
      markers: values.markers,
      onProgress: (r, m) => progress(r * 0.95, m)
    });
    const empty = !text.replace(/===== Page \d+ =====|\(no extractable text\)/g, '').trim();
    return {
      blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
      filename: pdfName(files[0].name).replace(/\.pdf$/, '.txt'),
      summary: empty ? 'No text layer found — this PDF is probably a scan.' : `Extracted text from ${doc.numPages} pages.`,
      details: empty ? ['Scanned pages have no text layer; OCR would be needed.'] : [`${text.length.toLocaleString()} characters`],
      preview: { kind: 'text', text: text.slice(0, 4000) }
    };
  }
};

export const textToPdf = {
  id: 'text-to-pdf',
  name: 'Text to PDF',
  desc: 'Typeset a .txt file (or pasted text) into a clean, paginated PDF.',
  icon: 'type',
  category: 'convert',
  inputs: { files: 'text', multiple: false, optional: true },
  params: [
    { key: 'text', label: 'Or paste text here', type: 'textarea', default: '', placeholder: 'Paste any text…' },
    { key: 'size', label: 'Page size', type: 'select', default: 'a4', options: Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.label })) },
    { key: 'fontSize', label: 'Font size', type: 'number', default: 11, min: 7, max: 24 },
    { key: 'title', label: 'Document title', type: 'text', default: '', placeholder: 'Optional' }
  ],
  async run({ files, values, progress }) {
    const { PDFDocument, StandardFonts } = pdfLib();
    let text = values.text || '';
    if (!text && files[0]) text = await readAsText(files[0]);
    if (!text.trim()) throw new Error('Paste some text or choose a .txt file.');

    const replaced = (text.match(/[^\u0000-\u00ff\u2018\u2019\u201c\u201d\u2013\u2014\u2026]/g) || []).length;
    const normalised = text
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
      .replace(/[^\u0000-\u00ff]/g, '?');

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const size = Number(values.fontSize) || 11;
    const target = PAGE_SIZES[values.size] || PAGE_SIZES.a4;
    const margin = 56;
    const lineHeight = size * 1.45;
    const maxWidth = target.w - margin * 2;
    const title = (values.title || '').trim();

    let page = doc.addPage([target.w, target.h]);
    let y = target.h - margin;
    if (title) {
      page.drawText(title.slice(0, 120), { x: margin, y: y - 18, size: 18, font: bold });
      y -= 40;
    }

    const paragraphs = normalised.split(/\r?\n/);
    let lineCount = 0;
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) { y -= lineHeight * 0.7; continue; }
      const words = paragraph.split(/\s+/);
      let line = '';
      for (const word of words) {
        const candidate = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
        if (line) {
          page.drawText(line, { x: margin, y, size, font });
          y -= lineHeight;
          lineCount++;
        }
        line = word;
        if (y < margin) {
          page = doc.addPage([target.w, target.h]);
          y = target.h - margin;
        }
      }
      if (line) {
        page.drawText(line, { x: margin, y, size, font });
        y -= lineHeight;
        lineCount++;
      }
      y -= lineHeight * 0.35;
      if (y < margin) {
        page = doc.addPage([target.w, target.h]);
        y = target.h - margin;
      }
    }
    progress(0.95, 'Writing the PDF');
    const bytes = await doc.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(values.title || 'text', '.pdf').replace(/\.pdf\.pdf$/, '.pdf'),
      summary: `Typeset ${lineCount} lines onto ${doc.getPageCount()} page${doc.getPageCount() === 1 ? '' : 's'}.`,
      details: replaced ? [`${replaced} character${replaced === 1 ? '' : 's'} outside Latin-1 were replaced with "?". Standard PDF fonts cannot encode non-Latin scripts.`] : [],
      preview: { kind: 'pdf' }
    };
  }
};

export const screenshot = {
  id: 'screenshot',
  name: 'Page screenshot',
  desc: 'Save a single page as a high-resolution PNG.',
  icon: 'crosshair',
  category: 'inspect',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'page', label: 'Page number', type: 'number', default: 1, min: 1 },
    { key: 'dpi', label: 'Resolution', type: 'select', default: '200', options: [
      { value: '96', label: '96 DPI' }, { value: '150', label: '150 DPI' },
      { value: '200', label: '200 DPI' }, { value: '300', label: '300 DPI' }
    ] }
  ],
  async run({ files, values, progress }) {
    const { doc } = await openForRender(files[0]);
    const num = Math.min(doc.numPages, Math.max(1, Number(values.page) || 1));
    progress(0.4, `Rendering page ${num}`);
    const rendered = await renderPages(doc, [num], { scale: (Number(values.dpi) || 200) / 72, quality: 1 });
    const blob = await imageBlobFor(rendered[0].canvas, 'image/png', 1);
    return {
      blob,
      filename: pdfName(files[0].name).replace(/\.pdf$/, `-page-${num}.png`),
      summary: `Saved page ${num} as a PNG.`,
      details: [`${rendered[0].width} × ${rendered[0].height} px`],
      preview: { kind: 'image', blob }
    };
  }
};
