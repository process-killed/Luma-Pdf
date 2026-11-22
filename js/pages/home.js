// Homepage: open flows, quick tools and recent documents.
import { boot, openLocalFile, openRemoteUrl, wireDropzone, toast } from '../app.js';
import { getTool } from '../tools/catalog.js';
import { recentDocuments } from '../storage/history.js';
import { icon } from '../ui/icons.js';
import { initMenus } from '../ui/ui.js';
import { announce } from '../utils/accessibility.js';

const QUICK = ['merge', 'split', 'compress', 'pdf-to-jpg', 'images-to-pdf', 'watermark', 'page-numbers', 'metadata'];

async function main() {
  await boot({ active: '' });
  initMenus();

  renderQuickTools();

  const dropzone = document.getElementById('home-dropzone');
  wireDropzone(dropzone, async (files) => {
    const file = files[0];
    if (file) await openLocalFile(file);
  });

  const form = document.getElementById('url-form');
  const input = document.getElementById('url-input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) { toast('Paste a link to a PDF first.', { type: 'warn' }); input.focus(); return; }
    openRemoteUrl(input.value.trim());
  });

  document.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (/^https?:\/\/\S+\.pdf(\?\S*)?$/i.test(text.trim())) {
      input.value = text.trim();
      toast('Link pasted — press Open', { duration: 2200 });
    }
  });

  await renderRecent();
}

function renderQuickTools() {
  const host = document.getElementById('quick-tools');
  if (!host) return;
  host.innerHTML = QUICK.map((id) => {
    const tool = getTool(id);
    if (!tool) return '';
    return `<a class="tool-tile" href="tools.html#${tool.id}">
      <div class="tt-top"><span class="tt-icon">${icon(tool.icon, 'icon-sm')}</span><span class="tt-name">${tool.name}</span></div>
      <span class="tt-desc">${tool.desc}</span>
    </a>`;
  }).join('');
}

async function renderRecent() {
  const host = document.getElementById('home-recent');
  const list = document.getElementById('home-recent-list');
  if (!host || !list) return;
  let docs = [];
  try { docs = await recentDocuments(4); } catch { docs = []; }
  if (!docs.length) return;
  host.hidden = false;
  list.innerHTML = docs.map((doc) => `
    <button class="recent-item" data-id="${doc.id}" type="button">
      ${icon('file-text', 'icon-sm')}
      <span class="ri-name truncate">${escapeHtml(doc.name)}</span>
      <span class="ri-page">${doc.pageCount ? doc.pageCount + 'p' : ''}</span>
    </button>`).join('');
  list.querySelectorAll('.recent-item').forEach((btn) => {
    btn.addEventListener('click', () => { location.href = `viewer.html?doc=${encodeURIComponent(btn.dataset.id)}`; });
  });
  announce(`${docs.length} recent documents available`);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch((e) => {
  console.error(e);
  toast('The homepage failed to start: ' + e.message, { type: 'error' });
});
