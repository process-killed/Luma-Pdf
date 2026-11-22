// Split, extract, delete, rotate, crop and resize.
import { loadLibDoc, bytesOf, parsePageSpec, pdfLib, PAGE_SIZES } from './pdf-utils.js';
import { createZip } from '../utils/zip.js';
import { pdfName } from '../utils/files.js';

export const split = {
  id: 'split',
  name: 'Split PDF',
  desc: 'Cut a document into separate files by range, or one file per page.',
  icon: 'split',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'mode', label: 'Split mode', type: 'select', default: 'ranges', options: [
      { value: 'ranges', label: 'One file per range' },
      { value: 'each', label: 'One file per page' },
      { value: 'chunks', label: 'Fixed chunk size' }
    ] },
    { key: 'ranges', label: 'Ranges', type: 'text', default: '1-2, 3-4', placeholder: '1-2, 3-4', hint: 'Used for “one file per range”.' },
    { key: 'size', label: 'Pages per file', type: 'number', default: 5, min: 1, max: 500, hint: 'Used for “fixed chunk size”.' }
  ],
  async run({ files, values, progress }) {
    const { PDFDocument } = pdfLib();
    const src = await loadLibDoc(await bytesOf(files[0]));
    const total = src.getPageCount();
    const groups = [];

    if (values.mode === 'each') {
      for (let i = 1; i <= total; i++) groups.push([i]);
    } else if (values.mode === 'chunks') {
      const size = Math.max(1, Number(values.size) || 1);
      for (let start = 1; start <= total; start += size) {
        const group = [];
        for (let i = start; i < Math.min(total + 1, start + size); i++) group.push(i);
        groups.push(group);
      }
    } else {
      String(values.ranges || '').split(',').forEach((chunk) => {
        const pages = parsePageSpec(chunk, total, { defaultAll: false });
        if (pages.length) groups.push(pages);
      });
    }
    if (!groups.length) throw new Error('No pages matched. Check the ranges, for example 1-3, 7.');

    const entries = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      progress((i + 0.2) / groups.length, `Building part ${i + 1} of ${groups.length}`);
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, group.map((n) => n - 1));
      pages.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      entries.push({
        name: `part-${String(i + 1).padStart(2, '0')}-pages-${group[0]}${group.length > 1 ? '-' + group[group.length - 1] : ''}.pdf`,
        data: bytes
      });
      await new Promise((r) => setTimeout(r, 0));
    }
    progress(0.95, 'Packaging files');

    if (entries.length === 1) {
      return {
        blob: new Blob([entries[0].data], { type: 'application/pdf' }),
        filename: pdfName(files[0].name, '-part-1'),
        summary: `Created 1 file with ${groups[0].length} pages.`,
        details: [`Pages ${groups[0].join(', ')}`],
        preview: { kind: 'pdf' }
      };
    }
    return {
      blob: createZip(entries),
      filename: pdfName(files[0].name, '-split') + '.zip',
      summary: `Created ${entries.length} files in a ZIP archive.`,
      details: entries.map((e) => e.name),
      preview: { kind: 'list', items: entries.map((e) => ({ name: e.name, size: e.data.length })) }
    };
  }
};

export const extract = {
  id: 'extract',
  name: 'Extract pages',
  desc: 'Save just the pages you choose as a new PDF.',
  icon: 'layers',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'pages', label: 'Pages to keep', type: 'text', default: '1', placeholder: '1-3, 7', hint: 'Everything else is dropped.' },
    { key: 'separate', label: 'One file per page', type: 'checkbox', default: false }
  ],
  async run({ files, values, progress }) {
    const { PDFDocument } = pdfLib();
    const src = await loadLibDoc(await bytesOf(files[0]));
    const total = src.getPageCount();
    const pages = parsePageSpec(values.pages, total);
    if (!pages.length) throw new Error('No pages matched that range.');

    if (values.separate) {
      const entries = [];
      for (let i = 0; i < pages.length; i++) {
        progress((i + 0.2) / pages.length, `Page ${pages[i]}`);
        const out = await PDFDocument.create();
        const [p] = await out.copyPages(src, [pages[i] - 1]);
        out.addPage(p);
        entries.push({ name: `page-${String(pages[i]).padStart(3, '0')}.pdf`, data: await out.save() });
      }
      return {
        blob: createZip(entries),
        filename: pdfName(files[0].name, '-pages') + '.zip',
        summary: `Extracted ${entries.length} single-page files.`,
        details: entries.map((e) => e.name),
        preview: { kind: 'list', items: entries.map((e) => ({ name: e.name, size: e.data.length })) }
      };
    }

    progress(0.5, 'Copying pages');
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, pages.map((n) => n - 1));
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-extracted'),
      summary: `Kept ${pages.length} of ${total} pages.`,
      details: [`Pages: ${pages.join(', ')}`],
      preview: { kind: 'pdf' }
    };
  }
};

export const deletePages = {
  id: 'delete-pages',
  name: 'Delete pages',
  desc: 'Remove pages you do not need. The original file is never changed.',
  icon: 'trash',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'pages', label: 'Pages to delete', type: 'text', default: '', placeholder: '2, 5-6', hint: 'You will be asked to confirm before anything is written.' }
  ],
  async run({ files, values, progress }) {
    const src = await loadLibDoc(await bytesOf(files[0]));
    const total = src.getPageCount();
    const remove = parsePageSpec(values.pages, total, { defaultAll: false });
    if (!remove.length) throw new Error('List the pages to delete, for example 2, 5-6.');
    if (remove.length >= total) throw new Error('That would delete every page. Leave at least one page in the document.');
    const keep = [];
    for (let i = 1; i <= total; i++) if (!remove.includes(i)) keep.push(i);
    progress(0.5, 'Rebuilding the document');
    const out = await pdfLib().PDFDocument.create();
    const pages = await out.copyPages(src, keep.map((n) => n - 1));
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-pages-removed'),
      summary: `Removed ${remove.length} page${remove.length === 1 ? '' : 's'} — ${keep.length} remain.`,
      details: [`Deleted: ${remove.join(', ')}`],
      preview: { kind: 'pdf' }
    };
  }
};

export const rotate = {
  id: 'rotate',
  name: 'Rotate PDF',
  desc: 'Turn pages 90°, 180° or 270° — all of them or only some.',
  icon: 'rotate-cw',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'angle', label: 'Rotation', type: 'select', default: '90', options: [
      { value: '90', label: '90° clockwise' },
      { value: '180', label: '180°' },
      { value: '270', label: '90° anticlockwise' }
    ] },
    { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' }
  ],
  async run({ files, values, progress }) {
    const { degrees } = pdfLib();
    const doc = await loadLibDoc(await bytesOf(files[0]));
    const total = doc.getPageCount();
    const targets = parsePageSpec(values.pages, total);
    const delta = Number(values.angle) || 90;
    progress(0.5, 'Rotating pages');
    doc.getPages().forEach((page, index) => {
      if (!targets.includes(index + 1)) return;
      const current = page.getRotation().angle || 0;
      page.setRotation(degrees((current + delta) % 360));
    });
    const bytes = await doc.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-rotated'),
      summary: `Rotated ${targets.length} page${targets.length === 1 ? '' : 's'} by ${delta}°.`,
      details: [`Pages: ${targets.length === total ? 'all' : targets.join(', ')}`],
      preview: { kind: 'pdf' }
    };
  }
};

export const crop = {
  id: 'crop',
  name: 'Crop PDF',
  desc: 'Trim margins by setting a crop box on every page.',
  icon: 'crop',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'top', label: 'Top (pt)', type: 'number', default: 18, min: 0, max: 2000 },
    { key: 'right', label: 'Right (pt)', type: 'number', default: 18, min: 0, max: 2000 },
    { key: 'bottom', label: 'Bottom (pt)', type: 'number', default: 18, min: 0, max: 2000 },
    { key: 'left', label: 'Left (pt)', type: 'number', default: 18, min: 0, max: 2000 }
  ],
  async run({ files, values, progress }) {
    const doc = await loadLibDoc(await bytesOf(files[0]));
    const { top, right, bottom, left } = {
      top: Number(values.top) || 0, right: Number(values.right) || 0,
      bottom: Number(values.bottom) || 0, left: Number(values.left) || 0
    };
    progress(0.5, 'Cropping pages');
    doc.getPages().forEach((page) => {
      const { width, height } = page.getSize();
      const w = Math.max(20, width - left - right);
      const h = Math.max(20, height - bottom - top);
      page.setCropBox(left, bottom, w, h);
    });
    const bytes = await doc.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-cropped'),
      summary: `Cropped ${doc.getPageCount()} pages (top ${top}, right ${right}, bottom ${bottom}, left ${left} pt).`,
      details: ['Crop boxes are visible in most readers; the page content is not deleted.'],
      preview: { kind: 'pdf' }
    };
  }
};

export const resize = {
  id: 'resize',
  name: 'Resize pages',
  desc: 'Scale every page onto a standard paper size, preserving the aspect ratio.',
  icon: 'actual-size',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'size', label: 'Target size', type: 'select', default: 'a4', options: Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.label })) },
    { key: 'orientation', label: 'Orientation', type: 'select', default: 'auto', options: [
      { value: 'auto', label: 'Match each page' },
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' }
    ] }
  ],
  async run({ files, values, progress }) {
    const { PDFDocument } = pdfLib();
    const src = await loadLibDoc(await bytesOf(files[0]));
    const target = PAGE_SIZES[values.size] || PAGE_SIZES.a4;
    const out = await PDFDocument.create();
    const srcPages = src.getPages();
    for (let i = 0; i < srcPages.length; i++) {
      const srcPage = srcPages[i];
      const { width, height } = srcPage.getSize();
      const landscape = values.orientation === 'landscape' || (values.orientation === 'auto' && width > height);
      const pw = landscape ? target.h : target.w;
      const ph = landscape ? target.w : target.h;
      const scale = Math.min(pw / width, ph / height);
      const newPage = out.addPage([pw, ph]);
      const embedded = await out.embedPage(srcPage);
      newPage.drawPage(embedded, {
        x: (pw - width * scale) / 2,
        y: (ph - height * scale) / 2,
        xScale: scale,
        yScale: scale
      });
      progress((i + 1) / srcPages.length, `Page ${i + 1} of ${srcPages.length}`);
      await new Promise((r) => setTimeout(r, 0));
    }
    const bytes = await out.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, `-${values.size}`),
      summary: `Resized ${srcPages.length} pages to ${target.label}.`,
      details: ['Pages are centred and scaled to fit, never stretched.'],
      preview: { kind: 'pdf' }
    };
  }
};
