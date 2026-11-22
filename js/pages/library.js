// Local library page — saved documents, storage and cleanup.
import { boot } from '../app.js';
import { listDocuments, removeDocument, renameDocument, toggleFavorite, clearLibrary, storageEstimate, getReadingState, libraryAvailable } from '../storage/library.js';
import { saveDocument } from '../storage/library.js';
import { toast, confirmDialog, promptDialog, dialog, initMenus } from '../ui/ui.js';
import { icon } from '../ui/icons.js';
import { formatBytes, formatDate, downloadBlob, isPdfFile } from '../utils/files.js';
import { announce } from '../utils/accessibility.js';

const S = { docs: [], filter: 'all', query: '' };

const els = {};

async function main() {
  els.list = document.getElementById('lib-list');
  await boot({ active: 'library' });
  initMenus();

  document.getElementById('lib-add').addEventListener('click', () => document.getElementById('lib-file').click());
  document.getElementById('lib-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isPdfFile(file)) { toast('That is not a PDF.', { type: 'warn' }); return; }
    try {
      const rec = await saveDocument({ name: file.name, blob: file, size: file.size });
      toast('Saved to your library', { type: 'success' });
      location.href = `viewer.html?doc=${encodeURIComponent(rec.id)}`;
    } catch (err) {
      toast('Could not save: ' + err.message, { type: 'error' });
    }
  });

  document.getElementById('lib-search').addEventListener('input', (e) => {
    S.query = e.target.value.trim().toLowerCase();
    renderList();
  });
  document.querySelectorAll('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      S.filter = b.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderList();
    });
  });

  await refresh();
}

async function refresh() {
  if (!libraryAvailable()) {
    els.list.innerHTML = `<div class="empty"><div class="empty-icon">${icon('alert')}</div>
      <h3>Local storage is unavailable</h3><p>This browser blocks IndexedDB, so saved documents cannot be kept. Private windows and strict tracking protection usually cause this.</p></div>`;
    return;
  }
  S.docs = await listDocuments();
  await renderStats();
  await renderList();
}

async function renderStats() {
  const total = S.docs.reduce((sum, d) => sum + (d.size || 0), 0);
  document.getElementById('stat-docs').textContent = String(S.docs.length);
  document.getElementById('stat-size').textContent = formatBytes(total);
  const est = await storageEstimate();
  if (est.quota) {
    const pct = Math.min(100, est.percent || 0);
    document.getElementById('stat-bar').style.width = `${pct}%`;
    document.getElementById('stat-quota').textContent = `${formatBytes(est.usage)} of ${formatBytes(est.quota)} available to this site`;
  } else {
    document.getElementById('stat-quota').textContent = 'This browser does not report a storage quota.';
  }
}

async function renderList() {
  const filtered = S.docs.filter((d) => {
    if (S.filter === 'favorites' && !d.favorite) return false;
    if (S.query && !d.name.toLowerCase().includes(S.query)) return false;
    return true;
  });

  if (!S.docs.length) {
    els.list.innerHTML = `<div class="empty">
      <div class="empty-icon">${icon('folder')}</div>
      <h3>No saved documents yet</h3>
      <p>Open a PDF in the viewer and choose “Save to library”, or add one here. Saved files stay in this browser and open offline.</p>
      <button class="btn btn-primary" onclick="document.getElementById('lib-file').click()">Add a PDF</button>
    </div>`;
    return;
  }
  if (!filtered.length) {
    els.list.innerHTML = `<div class="empty"><div class="empty-icon">${icon('search')}</div>
      <h3>Nothing matches</h3><p>Try a different search, or switch back to “All”.</p></div>`;
    return;
  }

  const rows = await Promise.all(filtered.map(async (doc) => {
    const reading = await getReadingState(doc.id).catch(() => null);
    const pct = doc.pageCount && reading?.page ? Math.round((reading.page / doc.pageCount) * 100) : 0;
    return `<div class="card" style="padding:12px 14px">
      <div class="row" style="gap:12px;align-items:flex-start">
        <span class="fr-icon" style="width:34px;height:34px">${icon('file-text')}</span>
        <div class="grow">
          <div class="row" style="gap:8px">
            <strong class="truncate" style="font-size:14px">${escapeHtml(doc.name)}</strong>
            ${doc.favorite ? `<span class="badge badge-accent">Favourite</span>` : ''}
          </div>
          <div class="small muted" style="margin-top:3px">
            ${doc.pageCount ? doc.pageCount + ' pages · ' : ''}${formatBytes(doc.size)} · opened ${formatDate(doc.lastOpened)}
          </div>
          ${reading?.page ? `<div class="small muted" style="margin-top:6px">Reading position: page ${reading.page}${doc.pageCount ? ' of ' + doc.pageCount : ''}</div>
            <div class="progress" style="margin-top:5px;height:4px"><i style="width:${pct}%"></i></div>` : ''}
        </div>
      </div>
      <div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap">
        <a class="btn btn-primary btn-sm" href="viewer.html?doc=${encodeURIComponent(doc.id)}">${icon('book-open', 'icon-sm')}Read</a>
        <a class="btn btn-outline btn-sm" href="editor.html?doc=${encodeURIComponent(doc.id)}">${icon('edit', 'icon-sm')}Edit pages</a>
        <button class="btn btn-ghost btn-sm" data-act="download" data-id="${doc.id}">${icon('download', 'icon-sm')}Download</button>
        <button class="btn btn-ghost btn-sm" data-act="favorite" data-id="${doc.id}">${icon('star', 'icon-sm')}${doc.favorite ? 'Unfavourite' : 'Favourite'}</button>
        <button class="btn btn-ghost btn-sm" data-act="rename" data-id="${doc.id}">${icon('edit', 'icon-sm')}Rename</button>
        <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${doc.id}" style="color:var(--danger)">${icon('trash', 'icon-sm')}Remove</button>
      </div>
    </div>`;
  }));
  els.list.innerHTML = rows.join('');
  wireRows();
  announce(`${filtered.length} documents in the library`);
}

function wireRows() {
  els.list.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const doc = S.docs.find((d) => d.id === id);
      if (!doc) return;
      const act = btn.dataset.act;
      if (act === 'download') {
        downloadBlob(doc.blob, doc.name);
        toast('Download started', { type: 'success', duration: 1800 });
      } else if (act === 'favorite') {
        await toggleFavorite(id);
        await refresh();
      } else if (act === 'rename') {
        const name = await promptDialog({ title: 'Rename document', label: 'File name', value: doc.name });
        if (!name) return;
        await renameDocument(id, /\.pdf$/i.test(name) ? name : name + '.pdf');
        await refresh();
        toast('Renamed', { type: 'success', duration: 1600 });
      } else if (act === 'delete') {
        const ok = await confirmDialog({
          title: 'Remove this document?',
          message: `“${doc.name}” and its saved annotations will be deleted from this browser. This cannot be undone.`,
          confirmLabel: 'Remove',
          danger: true
        });
        if (!ok) return;
        await removeDocument(id);
        await refresh();
        toast('Removed from the library', { type: 'success', duration: 2000 });
      }
    });
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch((e) => {
  console.error(e);
  toast('The library failed to load: ' + e.message, { type: 'error' });
});
