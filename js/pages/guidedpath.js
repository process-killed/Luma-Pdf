/** GuidedPath dashboard: create, open, manage, import and export tours. */
import { boot, toast } from '../app.js';
import { icon } from '../ui/icons.js';
import { formatBytes } from '../utils/files.js';
import { confirmDialog, promptDialog } from '../ui/ui.js';
import {
  listTours, getTour, saveTour, deleteTour, duplicateTour, exportTour, importTour,
  createTourFromFile, resolveDocument, listAssets
} from '../guidedpath/manager.js';
import { tourStorageUsage } from '../guidedpath/storage.js';

const els = {};
let tours = [];
let query = '';
let sortBy = 'updated';
const thumbUrls = new Map();

async function main() {
  await boot({ active: '' });
  els.list = document.getElementById('gp-list');
  els.empty = document.getElementById('gp-empty');
  els.usage = document.getElementById('gp-usage');
  els.search = document.getElementById('gp-search');
  els.sort = document.getElementById('gp-sort');

  document.getElementById('gp-create').addEventListener('click', () => document.getElementById('gp-create-file').click());
  document.getElementById('gp-create-file').addEventListener('change', onCreateFile);
  document.getElementById('gp-import').addEventListener('click', () => document.getElementById('gp-import-file').click());
  document.getElementById('gp-import-file').addEventListener('change', onImportFile);

  els.search.addEventListener('input', () => { query = els.search.value.trim().toLowerCase(); render(); });
  els.sort.addEventListener('change', () => { sortBy = els.sort.value; render(); });
  els.list.addEventListener('click', onCardAction);

  await refresh();
  if (location.hash === '#library') document.getElementById('library').scrollIntoView({ behavior: 'smooth' });
}

async function refresh() {
  try {
    tours = await listTours();
  } catch (err) {
    tours = [];
    toast('Local storage is unavailable, so tours cannot be listed here.', { type: 'error', duration: 5000 });
  }
  render();
  updateUsage();
}

async function updateUsage() {
  const usage = await tourStorageUsage().catch(() => null);
  if (!usage) { els.usage.textContent = ''; return; }
  const quota = usage.quota ? ` of ${formatBytes(usage.quota)} available` : '';
  els.usage.textContent = `${usage.tours} tour${usage.tours === 1 ? '' : 's'} · ${usage.assets} audio file${usage.assets === 1 ? '' : 's'} · ${formatBytes(usage.assetBytes)}${quota}`;
}

function visibleTours() {
  let list = tours.slice();
  if (query) {
    list = list.filter((t) => `${t.title} ${t.docName} ${t.description}`.toLowerCase().includes(query));
  }
  const sorters = {
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    title: (a, b) => String(a.title).localeCompare(String(b.title)),
    steps: (a, b) => (b.steps?.length || 0) - (a.steps?.length || 0)
  };
  return list.sort(sorters[sortBy] || sorters.updated);
}

function render() {
  const list = visibleTours();
  els.empty.hidden = list.length > 0;
  els.list.replaceChildren();

  for (const tour of list) {
    const card = document.createElement('article');
    card.className = 'gp-card';
    card.dataset.id = tour.id;
    card.setAttribute('role', 'listitem');
    const steps = tour.steps?.length || 0;
    const seconds = Math.round((tour.steps || []).reduce((s, x) => s + (x.duration || 0), 0) / 1000);
    const updated = tour.updatedAt ? new Date(tour.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const thumbKey = `thumb-${tour.id}`;
    const cached = thumbUrls.get(tour.id);
    card.innerHTML = `
      <div class="gp-card-thumb" data-ref="thumb">
        ${cached ? `<img src="${cached}" alt="">` : `<span class="gp-card-thumb-empty">${icon('book-open')}</span>`}
        <span class="gp-card-badge">${steps} step${steps === 1 ? '' : 's'}</span>
      </div>
      <div class="gp-card-body">
        <h3 class="gp-card-title">${escapeHtml(tour.title || 'Untitled tour')}</h3>
        <p class="gp-card-doc">${escapeHtml(tour.docName || 'PDF not linked')}</p>
        <p class="gp-card-meta">${steps} steps · ${seconds}s · edited ${updated}</p>
        ${tour.needsDocument ? '<p class="gp-card-warn">PDF needed to play this tour</p>' : ''}
      </div>
      <div class="gp-card-actions">
        <button class="btn btn-primary btn-sm" data-act="play">${icon('play', 'icon-sm')} Play</button>
        <button class="btn btn-ghost btn-sm" data-act="edit">${icon('edit', 'icon-sm')} Edit</button>
        <button class="gp-icon-btn" data-act="export" title="Export .lumatour" aria-label="Export tour">${icon('download')}</button>
        <button class="gp-icon-btn" data-act="rename" title="Rename" aria-label="Rename tour">${icon('edit')}</button>
        <button class="gp-icon-btn" data-act="duplicate" title="Duplicate" aria-label="Duplicate tour">${icon('copy')}</button>
        <button class="gp-icon-btn" data-act="delete" title="Delete" aria-label="Delete tour">${icon('trash')}</button>
      </div>`;
    els.list.append(card);
    if (!cached) loadThumb(tour, card.querySelector('[data-ref="thumb"]'));
  }
}

async function loadThumb(tour, host) {
  try {
    const assets = await listAssets(tour.id);
    const thumb = assets.find((a) => a.kind === 'thumbnail');
    if (!thumb?.blob) return;
    const url = URL.createObjectURL(thumb.blob);
    thumbUrls.set(tour.id, url);
    if (!host.isConnected) return;
    host.querySelector('.gp-card-thumb-empty')?.remove();
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    host.prepend(img);
  } catch { /* thumbnail is optional */ }
}

async function onCardAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.gp-card')?.dataset.id;
  const tour = tours.find((t) => t.id === id);
  if (!tour) return;
  const act = btn.dataset.act;

  if (act === 'play') await openTour(tour, 'play');
  else if (act === 'edit') await openTour(tour, 'studio');
  else if (act === 'export') await doExport(tour);
  else if (act === 'rename') await doRename(tour);
  else if (act === 'duplicate') { await duplicateTour(tour.id); await refresh(); toast('Tour duplicated', { duration: 1600 }); }
  else if (act === 'delete') await doDelete(tour);
}

async function openTour(tour, mode) {
  const doc = await resolveDocument(tour);
  if (!doc) {
    toast('The PDF for this tour is not on this device. Pick it to continue.', { type: 'warn', duration: 5000 });
    const picked = await pickPdf();
    if (!picked) return;
    const { attachDocument } = await import('../guidedpath/manager.js');
    const res = await attachDocument(tour, picked);
    if (!res.ok) { toast(res.reason, { type: 'error', duration: 5000 }); return; }
    location.href = `viewer.html?doc=${encodeURIComponent(res.doc.id)}&${mode}=${encodeURIComponent(tour.id)}`;
    return;
  }
  location.href = `viewer.html?doc=${encodeURIComponent(doc.id)}&${mode}=${encodeURIComponent(tour.id)}`;
}

async function doExport(tour) {
  try {
    const { blob, filename } = await exportTour(tour);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Tour exported — share the .lumatour file', { duration: 3000 });
  } catch (err) {
    toast(err.message || 'Could not export this tour.', { type: 'error', duration: 5000 });
  }
}

async function doRename(tour) {
  const title = await promptDialog({
    title: 'Rename tour',
    message: 'Give this GuidedPath a new name.',
    value: tour.title,
    confirmLabel: 'Rename'
  });
  if (!title) return;
  await saveTour({ ...tour, title: title.slice(0, 120) });
  await refresh();
}

async function doDelete(tour) {
  const ok = await confirmDialog({
    title: 'Delete this tour?',
    message: `“${tour.title}” and its narration will be removed from this device. Export it first if you want a copy.`,
    confirmLabel: 'Delete tour'
  });
  if (!ok) return;
  await deleteTour(tour.id);
  await refresh();
  toast('Tour deleted', { duration: 1600 });
}

async function onCreateFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    toast('Choose a PDF to start a GuidedPath.', { type: 'warn' });
    return;
  }
  try {
    toast('Saving the document…', { duration: 2000 });
    const { tour, docId } = await createTourFromFile(file);
    location.href = `viewer.html?doc=${encodeURIComponent(docId)}&studio=${encodeURIComponent(tour.id)}`;
  } catch (err) {
    toast(err.message || 'Could not start a tour with that file.', { type: 'error', duration: 5000 });
  }
}

async function onImportFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const result = await importTour(file);
    await refresh();
    if (result.doc) {
      toast('Tour imported', { duration: 2000 });
    } else {
      toast('Tour imported. Open it to choose the matching PDF.', { duration: 4000 });
    }
  } catch (err) {
    toast(err.message || 'That file could not be imported.', { type: 'error', duration: 6000 });
  }
}

function pickPdf() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
    input.click();
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main();
