// Inspection tools: metadata, counts, dimensions, version, encryption, outline, text.
import { pdfInfoFor, textOfOutline, allPageText, parsePageSpec } from './pdf-utils.js';
import { openForRender } from './pdf-utils.js';
import { openFromBytes } from '../viewer/pdf-engine.js';
import { formatBytes } from '../utils/files.js';

function reportBlob(text) {
  return new Blob([text], { type: 'text/plain;charset=utf-8' });
}

export const metadata = {
  id: 'metadata',
  name: 'Metadata viewer',
  desc: 'Read title, author, producer, dates and fingerprints from the file.',
  icon: 'info',
  category: 'inspect',
  inputs: { files: 'pdf', multiple: false },
  params: [],
  async run({ files }) {
    const { info, version, bytes } = await pdfInfoFor(files[0]);
    const lines = [
      `File: ${files[0].name}`,
      `Size: ${formatBytes(bytes.length)}`,
      `PDF version: ${version || 'unknown'}`,
      `Pages: ${info.pages}`,
      `Title: ${info.title || '—'}`,
      `Author: ${info.author || '—'}`,
      `Subject: ${info.subject || '—'}`,
      `Keywords: ${info.keywords || '—'}`,
      `Creator: ${info.creator || '—'}`,
      `Producer: ${info.producer || '—'}`,
      `Created: ${info.creationDate || '—'}`,
      `Modified: ${info.modDate || '—'}`,
      `Fingerprint: ${info.fingerprints?.[0] || '—'}`
    ];
    const text = lines.join('\n');
    return {
      blob: reportBlob(text),
      filename: 'metadata.txt',
      summary: info.title ? `“${info.title}” · ${info.pages} pages` : `${info.pages}-page PDF with no title`,
      details: lines.slice(3, 10),
      preview: { kind: 'text', text }
    };
  }
};

export const pageCount = {
  id: 'page-count',
  name: 'Page counter',
  desc: 'Count pages, and see how many are portrait or landscape.',
  icon: 'hash',
  category: 'inspect',
  inputs: { files: 'pdf', multiple: false },
  params: [],
  async run({ files }) {
    const { info, dims } = await pdfInfoFor(files[0]);
    const portrait = dims.filter((d) => d.height >= d.width).length;
    const text = [
      `File: ${files[0].name}`,
      `Pages: ${info.pages}`,
      `Sampled pages: ${dims.length}${dims.length < info.pages ? ' (first ' + dims.length + ')' : ''}`,
      `Portrait: ${portrait}`,
      `Landscape: ${dims.length - portrait}`
    ].join('\n');
    return {
      blob: reportBlob(text),
      filename: 'page-count.txt',
      summary: `${info.pages} pages`,
      details: [`${portrait} portrait · ${dims.length - portrait} landscape (in the first ${dims.length})`],
      preview: { kind: 'text', text }
    };
  }
};

export const fileInfo = {
  id: 'file-info',
  name: 'File information',
  desc: 'Size, page count, dimensions and version in one summary.',
  icon: 'file',
  category: 'inspect',
  inputs: { files: 'pdf', multiple: false },
  params: [],
  async run({ files }) {
    const { info, version, bytes } = await pdfInfoFor(files[0]);
    const text = [
      `Name: ${files[0].name}`,
      `Type: ${files[0].type || 'application/pdf'}`,
      `Size: ${formatBytes(bytes.length)} (${bytes.length.toLocaleString()} bytes)`,
      `Pages: ${info.pages}`,
      `PDF version: ${version || 'unknown'}`,
      `First page: ${info.firstPageSize.width} × ${info.firstPageSize.height} pt`,
      `Aspect: ${(info.firstPageSize.width / info.firstPageSize.height).toFixed(3)}`,
      `Encrypted: not detected`,
      `Fingerprint: ${info.fingerprints?.[0] || '—'}`
    ].join('\n');
    return {
      blob: reportBlob(text),
      filename: 'file-info.txt',
      summary: `${formatBytes(bytes.length)} · ${info.pages} pages · PDF ${version || '?'}`,
      details: [`${info.firstPageSize.width} × ${info.firstPageSize.height} pt first page`],
      preview: { kind: 'text', text }
    };
  }
};

export const dimensions = {
  id: 'dimensions',
  name: 'Page dimensions',
  desc: 'List the size of every page in points, millimetres and pixels at 96 DPI.',
  icon: 'grid',
  category: 'inspect',
  inputs: { files: 'pdf', multiple: false },
  params: [],
  async run({ files }) {
    const { info, dims } = await pdfInfoFor(files[0]);
    const rows = dims.map((d) => `Page ${d.page}: ${d.width} × ${d.height} pt · ${(d.width * 25.4 / 72).toFixed(0)} × ${(d.height * 25.4 / 72).toFixed(0)} mm · ${Math.round(d.width * 96 / 72)} × ${Math.round(d.height * 96 / 72)} px @96dpi`);
    const text = [`File: ${files[0].name}`, `Pages: ${info.pages}`, ...rows].join('\n');
    return {
      blob: reportBlob(text),
      filename: 'page-dimensions.txt',
      summary: `${dims.length} page${dims.length === 1 ? '' : 's'} measured`,
      details: dims.slice(0, 3).map((d) => `Page ${d.page}: ${d.width} × ${d.height} pt`),
      preview: { kind: 'text', text }
    };
  }
};

export const version = {
  id: 'version',
  name: 'PDF version',
  desc: 'Read the header version and check it against modern reader support.',
  icon: 'hash',
  category: 'inspect',
  inputs: { files: 'pdf', multiple: false },
  params: [],
  async run({ files }) {
    const { version: v, bytes } = await pdfInfoFor(files[0]);
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
    const binaryMarker = /%[^\n]{4}/.exec(head.slice(head.indexOf('%PDF') + 5));
    const text = [
      `File: ${files[0].name}`,
      `Header version: ${v || 'not found'}`,
      `Binary marker: ${binaryMarker ? 'present' : 'missing'}`,
      '',
      v ? `PDF ${v} is ${Number(v) >= 1.5 ? 'a modern version supported by every current browser and reader.' : 'an older version that modern readers still open.'}` : 'The file header is malformed.'
    ].join('\n');
    return {
      blob: reportBlob(text),
      filename: 'pdf-version.txt',
      summary: v ? `PDF ${v}` : 'Version not detected',
      details: [binaryMarker ? 'Binary marker present (standard)' : 'Binary marker missing (unusual but readable)'],
      preview: { kind: 'text', text }
    };
  }
};

export const passwordCheck = {
  id: 'password-check',
  name: 'Password check',
  desc: 'Detect encryption and test a password without uploading the file.',
  icon: 'lock',
  category: 'inspect',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'password', label: 'Password to test (optional)', type: 'text', default: '', placeholder: 'Leave empty to only detect encryption' }
  ],
  async run({ files, values }) {
    const bytes = new Uint8Array(await files[0].arrayBuffer());
    const result = await new Promise((resolve) => {
      (async () => {
        try {
          const doc = await openFromBytes(bytes, { password: values.password || undefined });
          const pages = doc.numPages;
          resolve({ ok: true, pages });
        } catch (err) {
          resolve({ ok: false, error: err });
        }
      })();
    });
    if (result.ok) {
      const text = `Encryption: ${values.password ? 'opened with the supplied password' : 'not required (or empty-password encryption)'}\nPages: ${result.pages}`;
      return {
        blob: reportBlob(text),
        filename: 'password-check.txt',
        summary: values.password ? 'The password works — the document opened.' : 'This PDF opened without a password.',
        details: ['Password checks run entirely in this browser.'],
        preview: { kind: 'text', text }
      };
    }
    const msg = /password/i.test(result.error?.message || '') || result.error?.name === 'PasswordException'
      ? 'This PDF is encrypted and needs a password.'
      : 'The file could not be opened: ' + (result.error?.message || 'unknown error');
    const text = `Encryption: detected\nResult: ${msg}`;
    return {
      blob: reportBlob(text),
      filename: 'password-check.txt',
      summary: msg,
      details: ['Encrypted PDFs cannot be edited by the other tools until the password is removed.'],
      preview: { kind: 'text', text }
    };
  }
};

export const outline = {
  id: 'outline',
  name: 'Extract outline',
  desc: 'Export the document’s bookmarks and table of contents as text.',
  icon: 'list',
  category: 'inspect',
  inputs: { files: 'pdf', multiple: false },
  params: [],
  async run({ files }) {
    const { outline: tree, info } = await pdfInfoFor(files[0]);
    if (!tree.length) {
      const text = `File: ${files[0].name}\nPages: ${info.pages}\n\nThis PDF has no embedded outline.`;
      return {
        blob: reportBlob(text),
        filename: 'outline.txt',
        summary: 'No embedded outline in this PDF.',
        details: ['Many PDFs have no bookmarks; that is not an error.'],
        preview: { kind: 'text', text }
      };
    }
    const text = `File: ${files[0].name}\nPages: ${info.pages}\n\n${textOfOutline(tree)}`;
    const flat = textOfOutline(tree).split('\n');
    return {
      blob: reportBlob(text),
      filename: 'outline.txt',
      summary: `${flat.length} outline entr${flat.length === 1 ? 'y' : 'ies'} extracted.`,
      details: flat.slice(0, 6),
      preview: { kind: 'text', text }
    };
  }
};

export const textExtract = {
  id: 'text-extract',
  name: 'Text extraction',
  desc: 'Extract text from a page range, with or without page markers.',
  icon: 'clipboard',
  category: 'inspect',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' },
    { key: 'markers', label: 'Page markers', type: 'checkbox', default: true }
  ],
  async run({ files, values, progress }) {
    const { doc } = await openForRender(files[0]);
    const pages = parsePageSpec(values.pages, doc.numPages);
    const parts = [];
    for (let i = 0; i < pages.length; i++) {
      const page = await doc.getPage(pages[i]);
      const content = await page.getTextContent();
      const text = content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
      page.cleanup();
      parts.push(values.markers ? `===== Page ${pages[i]} =====\n${text || '(no text)'}` : text);
      progress((i + 1) / pages.length, `Page ${pages[i]} of ${pages[pages.length - 1]}`);
      await new Promise((r) => setTimeout(r, 0));
    }
    const text = parts.join('\n\n');
    return {
      blob: reportBlob(text),
      filename: 'extracted-text.txt',
      summary: `Extracted text from ${pages.length} page${pages.length === 1 ? '' : 's'}.`,
      details: [`${text.length.toLocaleString()} characters`],
      preview: { kind: 'text', text: text.slice(0, 4000) }
    };
  }
};
