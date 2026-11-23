// Page layout tools: automatic margin cropping, N-up sheets and booklets.
import { loadLibDoc, bytesOf, pdfLib, parsePageSpec, openForRender, PAGE_SIZES } from './pdf-utils.js';
import { pdfName } from '../utils/files.js';

/** Find the ink bounding box of a rendered page, in page units. */
function contentBox(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const threshold = 247;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY, width, height };
}

export const autoCrop = {
  id: 'auto-crop',
  name: 'Auto-crop margins',
  desc: 'Detect the printed area on each page and trim the empty margins.',
  icon: 'crop',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'margin', label: 'Keep margin (pt)', type: 'number', default: 6, min: 0, max: 60 },
    { key: 'dpi', label: 'Detection resolution', type: 'select', default: '100', options: [
      { value: '72', label: '72 DPI — fast' },
      { value: '100', label: '100 DPI — balanced' },
      { value: '150', label: '150 DPI — precise' }
    ] },
    { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' }
  ],
  async run({ files, values, progress }) {
    const { doc } = await openForRender(files[0]);
    const lib = await loadLibDoc(await bytesOf(files[0]));
    const pages = parsePageSpec(values.pages, doc.numPages);
    const dpi = Number(values.dpi) || 100;
    const margin = Math.max(0, Number(values.margin) || 0);
    let cropped = 0;
    const skipped = [];

    for (let i = 0; i < pages.length; i++) {
      const num = pages[i];
      progress(0.05 + (i / pages.length) * 0.9, `Measuring page ${num}`);
      const proxy = await doc.getPage(num);
      const viewport = proxy.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await proxy.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
      proxy.cleanup();

      const target = lib.getPage(num - 1);
      const rotation = target.getRotation().angle || 0;
      if (rotation % 360 !== 0) { skipped.push(num); continue; }

      const box = contentBox(canvas);
      if (!box) { skipped.push(num); continue; }
      const k = 72 / dpi;
      const pageHeight = target.getSize().height;
      const left = Math.max(0, box.minX * k - margin);
      const right = Math.min(target.getSize().width, (box.maxX + 1) * k + margin);
      const top = Math.max(0, box.minY * k - margin);
      const bottom = Math.min(pageHeight, (box.maxY + 1) * k + margin);
      const w = right - left;
      const h = bottom - top;
      const size = target.getSize();
      if (w < size.width * 0.2 || h < pageHeight * 0.2) { skipped.push(num); continue; }
      target.setCropBox(left, pageHeight - bottom, w, h);
      cropped++;
      await new Promise((r) => setTimeout(r, 0));
    }

    const bytes = await lib.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-cropped'),
      summary: cropped ? `Cropped ${cropped} page${cropped === 1 ? '' : 's'} to their printed area.` : 'No page needed cropping.',
      details: [
        skipped.length ? `${skipped.length} page(s) skipped (rotated, blank or already tight): ${skipped.slice(0, 8).join(', ')}` : 'Every page had clear margins.',
        'Crop boxes change what is displayed; the content underneath is still in the file.'
      ],
      preview: { kind: 'pdf' }
    };
  }
};

function layoutCells(count) {
  const grid = { 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3] }[count] || [2, 2];
  const [cols, rows] = grid;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ col: c, row: r });
  }
  return { cols, rows, cells };
}

export const nUp = {
  id: 'n-up',
  name: 'N-up sheets',
  desc: 'Print 2, 4, 6 or 9 pages on each sheet, or impose a saddle-stitch booklet.',
  icon: 'grid',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'layout', label: 'Layout', type: 'select', default: '2', options: [
      { value: '2', label: '2 pages per sheet' },
      { value: '4', label: '4 pages per sheet' },
      { value: '6', label: '6 pages per sheet' },
      { value: '9', label: '9 pages per sheet' },
      { value: 'booklet', label: 'Booklet (fold & staple)' }
    ] },
    { key: 'sheet', label: 'Sheet size', type: 'select', default: 'a4', options: Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.label })) },
    { key: 'orientation', label: 'Sheet orientation', type: 'select', default: 'auto', options: [
      { value: 'auto', label: 'Best fit' },
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' }
    ] },
    { key: 'gap', label: 'Gap (pt)', type: 'number', default: 12, min: 0, max: 48 },
    { key: 'border', label: 'Draw page borders', type: 'checkbox', default: false }
  ],
  async run({ files, values, progress }) {
    const { PDFDocument } = pdfLib();
    const src = await loadLibDoc(await bytesOf(files[0]));
    const sourcePages = src.getPages();
    const total = sourcePages.length;
    const sheet = PAGE_SIZES[values.sheet] || PAGE_SIZES.a4;
    const gap = Math.max(0, Number(values.gap) || 0);

    // Build the page order and the sheet grid.
    let order = sourcePages.map((_, i) => i);
    let perSheet;
    let cols;
    let rows;
    if (values.layout === 'booklet') {
      const padded = Math.ceil(total / 4) * 4;
      order = [];
      for (let i = 0; i < padded / 2; i++) {
        const front = padded - i - 1;
        order.push(i, front);
      }
      // Reorder for saddle stitch: sheet 1 front = last, first; back = second, second-last…
      const sheets = [];
      for (let s = 0; s < padded / 4; s++) {
        const a = padded - 1 - s * 2;
        const b = s * 2;
        const c = s * 2 + 1;
        const d = padded - 2 - s * 2;
        sheets.push([a, b], [c, d]);
      }
      order = sheets.flat();
      perSheet = 2;
      cols = 2;
      rows = 1;
    } else {
      perSheet = Number(values.layout) || 2;
      ({ cols, rows } = layoutCells(perSheet));
    }

    const landscape = values.orientation === 'landscape' ||
      (values.orientation === 'auto' && (cols > rows || values.layout === 'booklet'));
    const sheetW = landscape ? sheet.h : sheet.w;
    const sheetH = landscape ? sheet.w : sheet.h;
    const cellW = (sheetW - gap * (cols + 1)) / cols;
    const cellH = (sheetH - gap * (rows + 1)) / rows;

    const out = await PDFDocument.create();
    const sheetCount = Math.ceil(order.length / perSheet);
    for (let s = 0; s < sheetCount; s++) {
      progress(0.1 + (s / sheetCount) * 0.85, `Building sheet ${s + 1} of ${sheetCount}`);
      const page = out.addPage([sheetW, sheetH]);
      const group = order.slice(s * perSheet, s * perSheet + perSheet);
      for (let i = 0; i < group.length; i++) {
        const index = group[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = gap + col * (cellW + gap);
        const y = sheetH - gap - (row + 1) * cellH - row * gap;
        if (index >= total) {
          if (values.border) page.drawRectangle({ x, y, width: cellW, height: cellH, borderColor: pdfLib().rgb(0.8, 0.8, 0.85), borderWidth: 0.5 });
          continue;
        }
        const srcPage = sourcePages[index];
        const embedded = await out.embedPage(srcPage);
        const { width: pw, height: ph } = srcPage.getSize();
        const scale = Math.min(cellW / pw, cellH / ph);
        const dx = x + (cellW - pw * scale) / 2;
        const dy = y + (cellH - ph * scale) / 2;
        page.drawPage(embedded, { x: dx, y: dy, xScale: scale, yScale: scale });
        if (values.border) page.drawRectangle({ x, y, width: cellW, height: cellH, borderColor: pdfLib().rgb(0.78, 0.78, 0.84), borderWidth: 0.5 });
      }
      await new Promise((r) => setTimeout(r, 0));
    }

    const bytes = await out.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, values.layout === 'booklet' ? '-booklet' : `-${values.layout}up`),
      summary: values.layout === 'booklet'
        ? `Booklet imposed: ${total} pages onto ${sheetCount} folded sheets.`
        : `${total} pages arranged ${perSheet}-up on ${sheetCount} sheet${sheetCount === 1 ? '' : 's'}.`,
      details: [
        values.layout === 'booklet'
          ? 'Print double-sided, flipping on the short edge, then fold and staple. Pages are padded with blanks to a multiple of four.'
          : 'Each sheet is a new page; the original pages are scaled to fit their cell.',
        `Sheet: ${sheet.label}${landscape ? ' landscape' : ' portrait'}`
      ],
      preview: { kind: 'pdf' }
    };
  }
};
