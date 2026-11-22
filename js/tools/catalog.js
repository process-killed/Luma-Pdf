// The complete tool catalogue — one place that lists what Luma PDF can do.
import { merge, reorder, duplicatePages } from './merge.js';
import { split, extract, deletePages, rotate, crop, resize } from './split.js';
import { pdfToJpg, pdfToPng, pdfToWebp, pdfToPrintImages, imagesToPdf, pdfToText, textToPdf, screenshot } from './convert.js';
import { compress, optimizeImages, reduceSize, stripMetadata, losslessOptimize } from './compress.js';
import { metadata, pageCount, fileInfo, dimensions, version, passwordCheck, outline, textExtract } from './metadata.js';
import { watermark, pageNumbers, signature } from './watermark.js';

export const CATEGORIES = [
  { id: 'organize', label: 'Organise pages', desc: 'Merge, split, reorder and reshape documents.' },
  { id: 'convert', label: 'Convert', desc: 'Move between PDF, images and plain text.' },
  { id: 'optimize', label: 'Optimise', desc: 'Shrink files and clean up metadata.' },
  { id: 'inspect', label: 'Inspect', desc: 'Read what is inside a document.' },
  { id: 'markup', label: 'Mark up', desc: 'Add watermarks, page numbers and signatures.' }
];

export const TOOLS = [
  merge, split, extract, deletePages, reorder, rotate, crop, resize, duplicatePages,
  pdfToJpg, pdfToPng, pdfToWebp, pdfToPrintImages, imagesToPdf, pdfToText, textToPdf,
  compress, optimizeImages, reduceSize, losslessOptimize, stripMetadata,
  metadata, pageCount, fileInfo, dimensions, version, passwordCheck, outline, textExtract, screenshot,
  watermark, pageNumbers, signature
];

export function getTool(id) {
  return TOOLS.find((t) => t.id === id) || null;
}

export function toolsByCategory() {
  return CATEGORIES.map((cat) => ({
    ...cat,
    tools: TOOLS.filter((t) => t.category === cat.id)
  })).filter((c) => c.tools.length);
}

export function toolCount() { return TOOLS.length; }

export const TOOL_LIMITS = {
  note: 'All processing happens in this tab. Files never leave your device.'
};
