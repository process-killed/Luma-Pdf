/**
 * Editor page — page organiser plus export-time content editing.
 */
import { boot } from '../app.js';
import { DocumentEditor } from '../editor/document-editor.js';
import { PageEditor } from '../editor/page-editor.js';
import { loadPdfLib } from '../utils/pdflib.js';
import { addTextOverlay, addWatermarkOverlay, addPageNumbersOverlay } from '../editor/text-editor.js';
import { addImageOverlay } from '../editor/image-editor.js';
import { toast, dialog, confirmDialog, setBusy, initMenus } from '../ui/ui.js';
import { icon } from '../ui/icons.js';
import { downloadBlob, formatBytes, pdfName } from '../utils/files.js';
import { getParams, normalizeUrl, filenameFromUrl } from '../utils/urls.js';
import { getDocument, saveDocument } from '../storage/library.js';

const S = { editor: null, pageEditor: null, loading: false };

async function main() {
  await boot({ active: 'editor' });
  initMenus();

  S.editor = new DocumentEditor();
  S.pageEditor = new PageEditor({
    editor: S.editor,
    container: document.getElementById('pages-area'),
    onChange: paintSelectionBar,
    onOpenPage: (index) => openInViewer(index)
  });

  S.editor.onChange = () => {
    S.pageEditor.render();
    renderOverlays();
    paintDocumentMeta();
  };

  // Small integration surface (also handy when debugging from the console).
  window.LumaEditor = { editor: S.editor, pageEditor: S.pageEditor };

  wire();
  S.pageEditor.render();
  paintDocumentMeta();

  const params = getParams();
  if (params.get('doc')) await loadFromLibrary(params.get('doc'));
  else if (params.get('file')) await loadFromUrl(params.get('file'));
}

function wire() {
  const fileInput = document.getElementById('file-input');
  const insertInput = document.getElementById('file-insert');

  document.getElementById('add-pdf').addEventListener('click', () => { fileInput.dataset.mode = 'replace'; fileInput.click(); });
  document.getElementById('add-more').addEventListener('click', () => { fileInput.dataset.mode = 'append'; fileInput.click(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    const mode = fileInput.dataset.mode || 'replace';
    fileInput.value = '';
    if (!file) return;
    if (mode === 'replace') {
      S.editor.reset();
      S.pageEditor.selection.clear();
      await addFile(file, { append: true });
    } else {
      await addFile(file, { append: true });
    }
  });

  document.getElementById('rot-left').addEventListener('click', () => withSelection((pages) => S.editor.rotate(pages, 270)));
  document.getElementById('rot-right').addEventListener('click', () => withSelection((pages) => S.editor.rotate(pages, 90)));
  document.getElementById('dup-sel').addEventListener('click', () => withSelection((pages) => S.editor.duplicate(pages)));
  document.getElementById('del-sel').addEventListener('click', async () => {
    const pages = S.pageEditor.selectedPages();
    if (!pages.length) { toast('Select pages first.', { type: 'warn' }); return; }
    if (pages.length >= S.editor.pages.length) { toast('Keep at least one page.', { type: 'warn' }); return; }
    const ok = await confirmDialog({
      title: `Delete ${pages.length} page${pages.length === 1 ? '' : 's'}?`,
      message: 'The pages are removed from the copy you export. Your original file is not changed.',
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    S.editor.delete(pages);
    S.pageEditor.selection.clear();
    S.pageEditor.render();
  });
  document.getElementById('extract-sel').addEventListener('click', () => {
    const pages = S.pageEditor.selectedPages();
    if (!pages.length) { toast('Select the pages you want to keep.', { type: 'warn' }); return; }
    S.editor.extract(pages);
    S.pageEditor.selection.clear();
    S.pageEditor.render();
  });
  document.getElementById('undo-btn').addEventListener('click', () => { if (S.editor.undo()) toast('Undone', { duration: 1200 }); });
  document.getElementById('redo-btn').addEventListener('click', () => { if (S.editor.redo()) toast('Redone', { duration: 1200 }); });
  document.getElementById('insert-blank').addEventListener('click', () => {
    const sel = S.pageEditor.selectionInfo();
    const at = sel.count ? Math.max(...sel.numbers) : S.editor.pages.length;
    S.editor.insertBlank(1, at);
    toast('Blank page inserted', { type: 'success', duration: 1600 });
  });
  document.getElementById('sel-all').addEventListener('click', () => S.pageEditor.selectAll());
  document.getElementById('sel-none').addEventListener('click', () => S.pageEditor.clearSelection());

  document.getElementById('add-text').addEventListener('click', () => addTextOverlay(S.editor, { selection: S.pageEditor.selectionInfo() }));
  document.getElementById('bar-text').addEventListener('click', () => addTextOverlay(S.editor, { selection: S.pageEditor.selectionInfo() }));
  document.getElementById('add-image').addEventListener('click', () => addImageOverlay(S.editor, { selection: S.pageEditor.selectionInfo() }));
  document.getElementById('add-watermark').addEventListener('click', () => addWatermarkOverlay(S.editor));
  document.getElementById('add-numbers').addEventListener('click', () => addPageNumbersOverlay(S.editor));

  document.getElementById('export-pdf').addEventListener('click', () => doExport('all'));
  document.getElementById('bar-export').addEventListener('click', () => doExport('all'));
  document.getElementById('export-selected').addEventListener('click', () => {
    if (!S.pageEditor.selection.size) { toast('Select the pages to export first.', { type: 'warn' }); return; }
    doExport('selection');
  });
  document.getElementById('save-library').addEventListener('click', saveToLibrary);

  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(e.target.tagName);
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) S.editor.redo(); else S.editor.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); S.pageEditor.selectAll(); }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const pages = S.pageEditor.selectedPages();
      if (pages.length && pages.length < S.editor.pages.length) {
        e.preventDefault();
        S.editor.delete(pages);
        S.pageEditor.selection.clear();
        S.pageEditor.render();
      }
    }
    if (e.key === 'Escape') S.pageEditor.clearSelection();
  });
}

function withSelection(fn) {
  const pages = S.pageEditor.selectedPages();
  if (!pages.length) { toast('Select at least one page.', { type: 'warn' }); return; }
  fn(pages);
}

async function addFile(file, { append = true } = {}) {
  if (S.loading) return;
  S.loading = true;
  const stop = toast(`Reading ${file.name}…`, { duration: 0 });
  try {
    await S.editor.addSource(file, { append });
    S.pageEditor.render();
    paintDocumentMeta();
    stop.close();
    toast(`${file.name} added — ${S.editor.pages.length} pages in the editor`, { type: 'success' });
  } catch (err) {
    stop.close();
    toast(err.message || 'That file could not be opened.', { type: 'error', duration: 7000 });
  } finally {
    S.loading = false;
  }
}

async function loadFromLibrary(id) {
  try {
    const rec = await getDocument(id);
    if (!rec?.blob) { toast('That document is no longer in this browser.', { type: 'error' }); return; }
    await addFile(new File([rec.blob], rec.name, { type: 'application/pdf' }), { append: false });
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

async function loadFromUrl(raw) {
  const url = normalizeUrl(raw);
  if (!url) { toast('That link is not a valid PDF address.', { type: 'error' }); return; }
  const stop = toast('Downloading the PDF…', { duration: 0 });
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`The server returned ${res.status}. Cross-origin reads must be allowed.`);
    const blob = await res.blob();
    stop.close();
    await addFile(new File([blob], filenameFromUrl(url), { type: 'application/pdf' }), { append: false });
  } catch (e) {
    stop.close();
    toast('Could not download that PDF: ' + e.message, { type: 'error', duration: 8000 });
  }
}

function paintDocumentMeta() {
  const name = document.getElementById('doc-name');
  const meta = document.getElementById('doc-meta');
  const count = S.editor.pages.length;
  name.textContent = S.editor.sources.size ? S.editor.name : 'No document';
  const sources = S.editor.sources.size;
  meta.textContent = count
    ? `${count} page${count === 1 ? '' : 's'}${sources > 1 ? ` · ${sources} sources` : ''}${S.editor.overlays.length ? ` · ${S.editor.overlays.length} overlay${S.editor.overlays.length === 1 ? '' : 's'}` : ''}`
    : '';
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = !S.editor.canUndo;
  if (redoBtn) redoBtn.disabled = !S.editor.canRedo;
  document.getElementById('export-pdf').disabled = !count;
  document.getElementById('export-selected').disabled = !count;
  document.getElementById('save-library').disabled = !count;
}

function paintSelectionBar(info) {
  const count = document.getElementById('sel-count');
  const hint = document.getElementById('sel-hint');
  if (!info || !info.total) {
    count.textContent = 'No pages';
    hint.textContent = 'Add a PDF to begin.';
    return;
  }
  count.textContent = info.count
    ? `${info.count} of ${info.total} selected`
    : `${info.total} page${info.total === 1 ? '' : 's'}`;
  hint.textContent = info.count
    ? `Pages ${info.numbers.join(', ')}`
    : 'Click a page to select · Shift-click for a range · drag to reorder';
}

function renderOverlays() {
  const host = document.getElementById('overlay-list');
  if (!host) return;
  if (!S.editor.overlays.length) { host.innerHTML = ''; return; }
  host.innerHTML = S.editor.overlays.map((o) => {
    const label = o.kind === 'text' ? `Text: “${(o.text || '').slice(0, 24)}”`
      : o.kind === 'image' ? 'Image / signature'
        : o.kind === 'watermark' ? `Watermark: ${o.text}`
          : `Page numbers (${o.format})`;
    return `<div class="side-item" style="padding:6px 8px">
      <span class="si-text truncate" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <button class="btn btn-ghost btn-icon btn-sm" data-ov="${o.id}" aria-label="Remove overlay">${icon('x', 'icon-sm')}</button>
    </div>`;
  }).join('');
  host.querySelectorAll('[data-ov]').forEach((b) => b.addEventListener('click', () => {
    S.editor.removeOverlay(b.dataset.ov);
  }));
}

async function doExport(scope) {
  if (!S.editor.pages.length) { toast('Add a PDF first.', { type: 'warn' }); return; }
  const btn = document.getElementById('export-pdf');
  setBusy(btn, true, 'Exporting');

  // Exporting a selection builds a temporary model with only those pages.
  const originalPages = S.editor.pages;
  if (scope === 'selection') {
    const keep = new Set(S.pageEditor.selectedPages().map((p) => p.id));
    S.editor.pages = originalPages.filter((p) => keep.has(p.id));
  }

  const stop = toast('Building your PDF…', { duration: 0 });
  try {
    const { blob, filename } = await S.editor.export({
      filename: scope === 'selection' ? pdfName(S.editor.name, '-selected') : undefined
    });
    stop.close();
    downloadBlob(blob, filename);
    toast(`Exported ${formatBytes(blob.size)} — ${filename}`, { type: 'success', duration: 5000 });
    await offerOpen(blob, filename);
  } catch (err) {
    stop.close();
    toast('Export failed: ' + (err.message || err), { type: 'error', duration: 8000 });
  } finally {
    S.editor.pages = originalPages;
    setBusy(btn, false);
    S.pageEditor.render();
  }
}

async function offerOpen(blob, filename) {
  const ok = await dialog({
    title: 'Export complete',
    sub: `${filename} · ${formatBytes(blob.size)}`,
    body: `<p class="small muted" style="line-height:1.6">The file is in your downloads. You can also open it in the Luma PDF viewer to check the result — it stays on this device.</p>`,
    actions: [
      { label: 'Done', value: false, variant: 'ghost' },
      { label: 'Open in viewer', value: true, variant: 'primary' }
    ]
  });
  if (ok) {
    try {
      const rec = await saveDocument({ name: filename, blob, pageCount: S.editor.pages.length, size: blob.size });
      location.href = `viewer.html?doc=${encodeURIComponent(rec.id)}`;
    } catch {
      const url = URL.createObjectURL(blob);
      window.open(`viewer.html?file=${encodeURIComponent(url)}`, '_blank');
    }
  }
}

function openInViewer(index) {
  const page = S.editor.pages[index];
  if (!page) return;
  toast('Previewing the original document — edits are applied on export.', { duration: 2600 });
  const src = S.editor.sources.get(page.srcId);
  if (!src) return;
  const url = URL.createObjectURL(new Blob([src.bytes], { type: 'application/pdf' }));
  window.open(`viewer.html?file=${encodeURIComponent(url)}&page=${page.index + 1}`, '_blank');
}

async function saveToLibrary() {
  if (!S.editor.pages.length) return;
  const stop = toast('Saving to your library…', { duration: 0 });
  try {
    const { blob, filename } = await S.editor.export();
    const rec = await saveDocument({ name: filename, blob, pageCount: S.editor.pages.length, size: blob.size });
    stop.close();
    toast('Saved locally. Open it any time from the Library.', {
      type: 'success',
      action: { label: 'Open in viewer', onClick: () => { location.href = `viewer.html?doc=${rec.id}`; } }
    });
  } catch (e) {
    stop.close();
    toast('Could not save: ' + e.message, { type: 'error' });
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch((e) => {
  console.error(e);
  toast('The editor failed to start: ' + e.message, { type: 'error', duration: 8000 });
});
