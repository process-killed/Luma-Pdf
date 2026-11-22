// Size reduction and metadata cleanup.
import { openForRender, pdfLib, loadLibDoc, bytesOf, renderPages, parsePageSpec } from './pdf-utils.js';
import { pdfName, formatBytes } from '../utils/files.js';

function compressTool({ id, name, desc, icon, defaultQuality, defaultDpi, note }) {
  return {
    id,
    name,
    desc,
    icon,
    category: 'optimize',
    inputs: { files: 'pdf', multiple: false },
    params: [
      { key: 'quality', label: 'Image quality', type: 'select', default: defaultQuality, options: [
        { value: '0.4', label: 'Aggressive (smallest)' },
        { value: '0.6', label: 'Balanced' },
        { value: '0.8', label: 'High quality' }
      ] },
      { key: 'dpi', label: 'Resolution', type: 'select', default: defaultDpi, options: [
        { value: '96', label: '96 DPI — screen' },
        { value: '120', label: '120 DPI' },
        { value: '150', label: '150 DPI — print' },
        { value: '200', label: '200 DPI' }
      ] },
      { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' }
    ],
    async run({ files, values, progress }) {
      const file = files[0];
      const { doc } = await openForRender(file);
      const pages = parsePageSpec(values.pages, doc.numPages);
      const dpi = Number(values.dpi) || 120;
      const quality = Number(values.quality) || 0.6;

      progress(0.05, 'Rendering pages');
      const rendered = await renderPages(doc, pages, {
        scale: dpi / 72,
        quality,
        maxPixels: 8_000_000,
        onProgress: (r, m) => progress(0.05 + r * 0.85, m)
      });

      const { PDFDocument } = pdfLib();
      const out = await PDFDocument.create();
      for (const item of rendered) {
        const page = out.addPage([item.width * 72 / dpi, item.height * 72 / dpi]);
        const img = await out.embedJpg(item.jpeg);
        page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
        await new Promise((r) => setTimeout(r, 0));
      }
      progress(0.95, 'Writing the PDF');
      const bytes = await out.save();
      const saved = file.size - bytes.length;
      const pct = file.size ? Math.round((saved / file.size) * 100) : 0;

      return {
        blob: new Blob([bytes], { type: 'application/pdf' }),
        filename: pdfName(file.name, '-compressed'),
        summary: saved > 0
          ? `Reduced ${formatBytes(file.size)} → ${formatBytes(bytes.length)} (${pct}% smaller).`
          : `The rebuilt file is ${formatBytes(bytes.length)} — larger than the original, so keep the original.`,
        details: [
          note,
          'Each page was re-rendered as a JPEG image, so text is no longer selectable and links are lost.',
          `Settings: ${dpi} DPI, quality ${Math.round(quality * 100)}%`
        ],
        preview: { kind: 'pdf' }
      };
    }
  };
}

export const compress = compressTool({
  id: 'compress',
  name: 'Compress PDF',
  desc: 'Rebuild the document with re-compressed page images to cut file size.',
  icon: 'zap',
  defaultQuality: '0.6',
  defaultDpi: '120',
  note: 'Best for scanned or image-heavy documents. Text-based PDFs often compress less.'
});

export const optimizeImages = compressTool({
  id: 'optimize-images',
  name: 'Optimise images',
  desc: 'Downsample page imagery for the web while keeping pages readable.',
  icon: 'image',
  defaultQuality: '0.7',
  defaultDpi: '96',
  note: 'Useful before publishing a PDF on a website or sending it by email.'
});

export const reduceSize = compressTool({
  id: 'reduce-size',
  name: 'Reduce output size',
  desc: 'The smallest result: low resolution, aggressive compression.',
  icon: 'filter',
  defaultQuality: '0.4',
  defaultDpi: '96',
  note: 'Small text may become hard to read. Check the preview before sharing.'
});

export const stripMetadata = {
  id: 'strip-metadata',
  name: 'Remove metadata',
  desc: 'Clear title, author, keywords and producer fields before sharing.',
  icon: 'shield',
  category: 'optimize',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'keepTitle', label: 'Keep the title', type: 'checkbox', default: false }
  ],
  async run({ files, values = {}, progress }) {
    const doc = await loadLibDoc(await bytesOf(files[0]));
    progress(0.4, 'Clearing metadata');
    const title = doc.getTitle();
    doc.setTitle(values.keepTitle && title ? title : '');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setProducer('');
    doc.setCreator('');
    doc.setLanguage?.('');
    const bytes = await doc.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-no-metadata'),
      summary: 'Metadata fields cleared.',
      details: ['Document content and pages are untouched. Some PDF producers embed extra XMP data that pdf-lib cannot remove.'],
      preview: { kind: 'pdf' }
    };
  }
};

export const losslessOptimize = {
  id: 'optimize-structure',
  name: 'Optimise structure',
  desc: 'Re-save the PDF with pdf-lib to normalise objects — no re-rendering, no quality loss.',
  icon: 'layers',
  category: 'optimize',
  inputs: { files: 'pdf', multiple: false },
  params: [],
  async run({ files, progress }) {
    const doc = await loadLibDoc(await bytesOf(files[0]));
    progress(0.5, 'Rewriting the document');
    const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    const diff = files[0].size - bytes.length;
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-optimised'),
      summary: diff > 0 ? `Saved ${formatBytes(diff)} by rewriting the object structure.` : 'Structure rewritten; the original was already compact.',
      details: ['Text, links and vectors are preserved exactly.'],
      preview: { kind: 'pdf' }
    };
  }
};
