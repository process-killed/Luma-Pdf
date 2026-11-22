// Marking tools: watermarks, page numbering, signature placement.
import { loadLibDoc, bytesOf, pdfLib, parsePageSpec, hexToRgb } from './pdf-utils.js';
import { pdfName, readAsDataURL, loadImage } from '../utils/files.js';
import { imageBlobFor } from './pdf-utils.js';

const POSITIONS = [
  { value: 'bottom-center', label: 'Bottom centre' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'top-center', label: 'Top centre' },
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' }
];

function anchor(pageW, pageH, position, margin = 36) {
  switch (position) {
    case 'bottom-right': return { x: pageW - margin, y: margin, align: 'right' };
    case 'bottom-left': return { x: margin, y: margin, align: 'left' };
    case 'top-center': return { x: pageW / 2, y: pageH - margin, align: 'center' };
    case 'top-right': return { x: pageW - margin, y: pageH - margin, align: 'right' };
    case 'top-left': return { x: margin, y: pageH - margin, align: 'left' };
    default: return { x: pageW / 2, y: margin, align: 'center' };
  }
}

export const watermark = {
  id: 'watermark',
  name: 'Add watermark',
  desc: 'Stamp text across every page — diagonal, tiled or in a corner.',
  icon: 'layers',
  category: 'markup',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'text', label: 'Watermark text', type: 'text', default: 'CONFIDENTIAL', placeholder: 'CONFIDENTIAL' },
    { key: 'size', label: 'Font size', type: 'number', default: 48, min: 8, max: 160 },
    { key: 'opacity', label: 'Opacity (%)', type: 'number', default: 14, min: 2, max: 100 },
    { key: 'angle', label: 'Angle', type: 'select', default: '45', options: [
      { value: '45', label: 'Diagonal (45°)' },
      { value: '0', label: 'Horizontal' },
      { value: '90', label: 'Vertical' }
    ] },
    { key: 'color', label: 'Colour', type: 'color', default: '#8b8b9a' },
    { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' }
  ],
  async run({ files, values, progress }) {
    const { degrees, StandardFonts } = pdfLib();
    const doc = await loadLibDoc(await bytesOf(files[0]));
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const pages = doc.getPages();
    const targets = parsePageSpec(values.pages, pages.length);
    const text = (values.text || '').trim();
    if (!text) throw new Error('Enter the watermark text.');
    const size = Math.max(8, Number(values.size) || 48);
    const opacity = Math.min(1, Math.max(0.02, (Number(values.opacity) || 14) / 100));
    const angle = Number(values.angle) || 0;
    const color = hexToRgb(values.color || '#8b8b9a');

    pages.forEach((page, i) => {
      if (!targets.includes(i + 1)) return;
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: height / 2 - size / 3,
        size,
        font,
        color,
        opacity,
        rotate: degrees(angle)
      });
      progress((i + 1) / pages.length, `Page ${i + 1} of ${pages.length}`);
    });
    const bytes = await doc.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-watermark'),
      summary: `Watermarked ${targets.length} page${targets.length === 1 ? '' : 's'} with “${text}”.`,
      details: [`${size} pt · ${Math.round(opacity * 100)}% opacity · ${angle}°`],
      preview: { kind: 'pdf' }
    };
  }
};

export const pageNumbers = {
  id: 'page-numbers',
  name: 'Add page numbers',
  desc: 'Number pages with a flexible format and starting value.',
  icon: 'hash',
  category: 'markup',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'position', label: 'Position', type: 'select', default: 'bottom-center', options: POSITIONS },
    { key: 'format', label: 'Format', type: 'select', default: 'n-of-total', options: [
      { value: 'n', label: '1' },
      { value: 'n-of-total', label: '1 / 12' },
      { value: 'page-n', label: 'Page 1' },
      { value: 'page-n-of-total', label: 'Page 1 of 12' }
    ] },
    { key: 'start', label: 'First number', type: 'number', default: 1, min: 0, max: 9999 },
    { key: 'size', label: 'Font size', type: 'number', default: 10, min: 6, max: 24 },
    { key: 'color', label: 'Colour', type: 'color', default: '#55555f' },
    { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' }
  ],
  async run({ files, values, progress }) {
    const { StandardFonts } = pdfLib();
    const doc = await loadLibDoc(await bytesOf(files[0]));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const targets = parsePageSpec(values.pages, pages.length);
    const start = Number(values.start) || 1;
    const size = Number(values.size) || 10;
    const color = hexToRgb(values.color || '#55555f');
    const total = targets.length;

    targets.forEach((pageNum, index) => {
      const page = pages[pageNum - 1];
      const { width, height } = page.getSize();
      const n = start + index;
      const last = start + total - 1;
      let label;
      switch (values.format) {
        case 'n': label = String(n); break;
        case 'page-n': label = `Page ${n}`; break;
        case 'page-n-of-total': label = `Page ${n} of ${last}`; break;
        default: label = `${n} / ${last}`;
      }
      const textWidth = font.widthOfTextAtSize(label, size);
      const a = anchor(width, height, values.position);
      const x = a.align === 'right' ? a.x - textWidth : a.align === 'center' ? a.x - textWidth / 2 : a.x;
      page.drawText(label, { x, y: a.y, size, font, color });
      progress((index + 1) / targets.length, `Page ${pageNum}`);
    });
    const bytes = await doc.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-numbered'),
      summary: `Numbered ${targets.length} page${targets.length === 1 ? '' : 's'} starting at ${start}.`,
      details: [`Position: ${POSITIONS.find((p) => p.value === values.position)?.label || values.position}`],
      preview: { kind: 'pdf' }
    };
  }
};

export const signature = {
  id: 'signature',
  name: 'Insert signature',
  desc: 'Place a signature image or drawn signature onto a chosen page.',
  icon: 'signature',
  category: 'markup',
  inputs: { files: 'pdf', multiple: false, extraImage: true },
  params: [
    { key: 'page', label: 'Page', type: 'number', default: 1, min: 1 },
    { key: 'position', label: 'Position', type: 'select', default: 'bottom-right', options: POSITIONS },
    { key: 'width', label: 'Width (pt)', type: 'number', default: 160, min: 40, max: 600 },
    { key: 'opacity', label: 'Opacity (%)', type: 'number', default: 100, min: 20, max: 100 }
  ],
  async run({ files, values, signatureFile, progress }) {
    const imageFile = signatureFile || files[1];
    if (!imageFile) throw new Error('Add a signature image (PNG with transparency works best).');
    const doc = await loadLibDoc(await bytesOf(files[0]));
    const pages = doc.getPages();
    const pageIndex = Math.min(pages.length, Math.max(1, Number(values.page) || 1)) - 1;
    const page = pages[pageIndex];

    progress(0.3, 'Embedding the signature');
    let image;
    const bytes = new Uint8Array(await imageFile.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) image = await doc.embedPng(bytes);
    else if (bytes[0] === 0xff && bytes[1] === 0xd8) image = await doc.embedJpg(bytes);
    else {
      const img = await loadImage(await readAsDataURL(imageFile));
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const png = await imageBlobFor(canvas, 'image/png');
      image = await doc.embedPng(new Uint8Array(await png.arrayBuffer()));
    }

    const { width: pw, height: ph } = page.getSize();
    const w = Math.min(Number(values.width) || 160, pw - 24);
    const h = w * (image.height / image.width);
    const a = anchor(pw, ph, values.position, 32);
    const x = a.align === 'right' ? a.x - w : a.align === 'center' ? a.x - w / 2 : a.x;
    const y = values.position.startsWith('top') ? a.y - h : a.y;
    page.drawImage(image, { x, y, width: w, height: h, opacity: Math.min(1, (Number(values.opacity) || 100) / 100) });
    progress(0.9, 'Writing the PDF');
    const out = await doc.save();
    return {
      blob: new Blob([out], { type: 'application/pdf' }),
      filename: pdfName(files[0].name, '-signed'),
      summary: `Signature placed on page ${pageIndex + 1}.`,
      details: [`${Math.round(w)} × ${Math.round(h)} pt at ${values.position}`, 'A visible signature image is not a cryptographic digital signature.'],
      preview: { kind: 'pdf' }
    };
  }
};
