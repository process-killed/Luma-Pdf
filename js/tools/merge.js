// Merge and page-order tools.
import { loadLibDoc, bytesOf, parsePageSpec, pdfLib } from './pdf-utils.js';
import { pdfName } from '../utils/files.js';

export const merge = {
  id: 'merge',
  name: 'Merge PDFs',
  desc: 'Combine two or more PDFs into a single document, in the order shown.',
  icon: 'merge',
  category: 'organize',
  inputs: { files: 'pdf', multiple: true, min: 2 },
  params: [],
  async run({ files, progress }) {
    const { PDFDocument } = pdfLib();
    const out = await PDFDocument.create();
    let total = 0;
    const details = [];
    for (let i = 0; i < files.length; i++) {
      progress((i + 0.3) / files.length, `Reading ${files[i].name}`);
      const src = await loadLibDoc(await bytesOf(files[i]));
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      total += pages.length;
      details.push(`${files[i].name}: ${pages.length} page${pages.length === 1 ? '' : 's'}`);
      await new Promise((r) => setTimeout(r, 0));
    }
    progress(0.95, 'Writing the merged document');
    const bytes = await out.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName('merged', `-${files.length}-files`),
      summary: `Merged ${files.length} files into ${total} pages.`,
      details,
      preview: { kind: 'pdf' }
    };
  }
};

export const reorder = {
  id: 'reorder',
  name: 'Reorder pages',
  desc: 'Rebuild the document with pages in a new order you type or paste.',
  icon: 'list',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'order', label: 'New page order', type: 'text', placeholder: '3,1,2,4-6', default: '', hint: 'Accepts single pages and ranges, in the order you want them.' }
  ],
  async run({ files, values, progress }) {
    const src = await loadLibDoc(await bytesOf(files[0]));
    const total = src.getPageCount();
    const order = parsePageSpec(values.order, total);
    if (!order.length) throw new Error('Enter the page order, for example 3,1,2 or 2-4,1.');
    const out = await pdfLib().PDFDocument.create();
    progress(0.4, 'Copying pages');
    const pages = await out.copyPages(src, order.map((n) => n - 1));
    pages.forEach((p) => out.addPage(p));
    progress(0.9, 'Writing the document');
    const bytes = await out.save();
    const skipped = total - order.length;
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-reordered'),
      summary: `Reordered ${order.length} of ${total} pages${skipped > 0 ? ` (${skipped} left out)` : ''}.`,
      details: [`New order: ${order.join(', ')}`],
      preview: { kind: 'pdf' }
    };
  }
};

export const duplicatePages = {
  id: 'duplicate-pages',
  name: 'Duplicate pages',
  desc: 'Repeat selected pages, optionally several times, in place.',
  icon: 'copy',
  category: 'organize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'pages', label: 'Pages to duplicate', type: 'text', placeholder: '1, 4-6', default: '1' },
    { key: 'times', label: 'Copies of each', type: 'number', default: 1, min: 1, max: 20 }
  ],
  async run({ files, values, progress }) {
    const src = await loadLibDoc(await bytesOf(files[0]));
    const total = src.getPageCount();
    const targets = parsePageSpec(values.pages, total);
    if (!targets.length) throw new Error('Choose at least one page to duplicate.');
    const times = Math.max(1, Math.min(20, Number(values.times) || 1));
    const order = [];
    for (let i = 1; i <= total; i++) {
      order.push(i);
      if (targets.includes(i)) for (let t = 0; t < times; t++) order.push(i);
    }
    progress(0.4, 'Building the page order');
    const out = await pdfLib().PDFDocument.create();
    const pages = await out.copyPages(src, order.map((n) => n - 1));
    pages.forEach((p) => out.addPage(p));
    progress(0.9, 'Writing the document');
    const bytes = await out.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-duplicated'),
      summary: `Added ${targets.length * times} duplicate page${targets.length * times === 1 ? '' : 's'} — now ${order.length} pages.`,
      details: [`Duplicated: ${targets.join(', ')} × ${times}`],
      preview: { kind: 'pdf' }
    };
  }
};
