/**
 * PDF → Markdown. A PDF stores glyphs at coordinates, not paragraphs, so the structure
 * is inferred from geometry: lines by baseline, headings by font size, lists by their
 * markers, paragraphs by vertical gaps. When a structure is not clearly present the
 * text comes out as a plain paragraph — inventing structure costs the reader more work
 * than leaving it out.
 */
import { openForRender, parsePageSpec } from './pdf-utils.js';
import { pdfName } from '../utils/files.js';

const LINE_TOLERANCE = 0.42;      // share of the median glyph height counted as one line
const WORD_GAP = 0.22;            // share of font size that becomes a space
const HEADING_RATIO = 1.16;       // size above the body text that marks a heading
const PARAGRAPH_GAP = 1.65;       // line gap (× font size) that ends a paragraph
const LIST_MARKER = /^([•▪◦‣·∙●○–—-]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Collect positioned text tokens for one page. */
async function pageTokens(page) {
  const content = await page.getTextContent();
  const tokens = [];
  for (const item of content.items) {
    if (typeof item.str !== 'string' || !item.str.trim()) continue;
    const tr = item.transform;
    const height = Math.hypot(tr[2], tr[3]) || item.height || 10;
    tokens.push({
      text: item.str,
      x: tr[4],
      y: tr[5],
      width: item.width || 0,
      height,
      fontName: item.fontName || ''
    });
  }
  return tokens;
}

/** Group tokens into visual lines, left to right. */
function toLines(tokens) {
  if (!tokens.length) return [];
  const heights = tokens.map((t) => t.height).filter((h) => h > 0);
  const tolerance = median(heights) * LINE_TOLERANCE;
  const lines = [];
  for (const token of [...tokens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - token.y) <= tolerance);
    if (line) {
      line.tokens.push(token);
      line.y = (line.y * (line.tokens.length - 1) + token.y) / line.tokens.length;
      line.height = Math.max(line.height, token.height);
    } else {
      lines.push({ y: token.y, height: token.height, tokens: [token] });
    }
  }
  lines.forEach((line) => line.tokens.sort((a, b) => a.x - b.x));
  return lines.sort((a, b) => b.y - a.y);
}

function lineText(line) {
  let out = '';
  let prev = null;
  for (const token of line.tokens) {
    if (prev) {
      const gap = token.x - (prev.x + prev.width);
      const spaceThreshold = Math.max(1, token.height * WORD_GAP);
      if (gap > spaceThreshold && !/\s$/.test(out) && !/^\s/.test(token.text)) out += ' ';
    }
    out += token.text;
    prev = token;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function escapeMarkdown(text) {
  return text
    .replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1')
    .replace(/\\\s/g, ' ');
}

export const pdfToMarkdown = {
  id: 'pdf-to-markdown',
  name: 'PDF to Markdown',
  desc: 'Rebuild headings, lists and paragraphs as a clean .md file.',
  icon: 'code',
  category: 'convert',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'Leave empty for all pages' },
    { key: 'pageMarkers', label: 'Insert page markers', type: 'checkbox', default: true },
    { key: 'escape', label: 'Escape Markdown characters', type: 'checkbox', default: false }
  ],
  async run({ files, values, progress }) {
    const { doc } = await openForRender(files[0]);
    const pages = parsePageSpec(values.pages, doc.numPages);
    if (!pages.length) throw new Error('No pages matched that range.');

    const blocks = [];
    let headingCount = 0;
    let listCount = 0;

    for (let i = 0; i < pages.length; i++) {
      progress(0.05 + (i / pages.length) * 0.9, `Reading page ${pages[i]}`);
      const page = await doc.getPage(pages[i]);
      const tokens = await pageTokens(page);
      page.cleanup();
      if (!tokens.length) {
        blocks.push({ type: 'empty', page: pages[i] });
        continue;
      }

      const lines = toLines(tokens);
      const bodySize = median(lines.map((l) => l.height).filter((h) => h > 0)) || 10;

      let paragraph = [];
      const flush = () => {
        if (!paragraph.length) return;
        blocks.push({ type: 'paragraph', page: pages[i], text: paragraph.join(' ') });
        paragraph = [];
      };

      lines.forEach((line, index) => {
        const text = lineText(line);
        if (!text) return;
        const size = line.height || bodySize;
        const ratio = size / bodySize;
        const prev = lines[index - 1];
        const gap = prev ? prev.y - line.y : 0;

        if (ratio >= HEADING_RATIO * 1.6) {
          flush();
          blocks.push({ type: 'heading', level: 1, page: pages[i], text });
          headingCount++;
        } else if (ratio >= HEADING_RATIO * 1.28) {
          flush();
          blocks.push({ type: 'heading', level: 2, page: pages[i], text });
          headingCount++;
        } else if (ratio >= HEADING_RATIO) {
          flush();
          blocks.push({ type: 'heading', level: 3, page: pages[i], text });
          headingCount++;
        } else if (LIST_MARKER.test(text)) {
          flush();
          blocks.push({ type: 'list', page: pages[i], text: text.replace(LIST_MARKER, '') });
          listCount++;
        } else {
          if (prev && gap > bodySize * PARAGRAPH_GAP) flush();
          paragraph.push(text);
        }
      });
      flush();
      await new Promise((r) => setTimeout(r, 0));
    }

    const out = [];
    let lastPage = null;
    for (const block of blocks) {
      if (values.pageMarkers && block.page !== lastPage) {
        out.push(`<!-- page ${block.page} -->`);
        lastPage = block.page;
      }
      const text = values.escape ? escapeMarkdown(block.text || '') : (block.text || '');
      if (block.type === 'heading') out.push(`${'#'.repeat(block.level)} ${text}`);
      else if (block.type === 'list') out.push(`- ${text}`);
      else if (block.type === 'paragraph') out.push(text);
    }

    const markdown = out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    const words = markdown.split(/\s+/).filter(Boolean).length;
    return {
      blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      filename: pdfName(files[0].name).replace(/\.pdf$/, '.md'),
      summary: `${words.toLocaleString()} words · ${headingCount} heading${headingCount === 1 ? '' : 's'} · ${listCount} list item${listCount === 1 ? '' : 's'}.`,
      details: [
        'Structure is inferred from font size, list markers and vertical gaps.',
        'Bold, italic, images and tables are not reproduced — this is a text-first conversion.',
        'Pages without a text layer produce nothing; run OCR first for scans.'
      ],
      preview: { kind: 'text', text: markdown.slice(0, 4000) }
    };
  }
};
