/**
 * PDF Tools page — catalogue, runner, file handling and result preview.
 */
import { boot } from '../app.js';
import { icon } from '../ui/icons.js';
import { toast, dialog, confirmDialog, setBusy, initMenus } from '../ui/ui.js';
import { downloadBlob, formatBytes, isPdfFile } from '../utils/files.js';
import { CATEGORIES, TOOLS, getTool, toolsByCategory, toolCount } from '../tools/catalog.js';
import { currentProfile } from '../app.js';

const S = { files: [], signatureFile: null, tool: null, result: null, urls: [], running: false };

const els = {};

async function main() {
  els.grid = document.getElementById('tools-grid');
  els.runner = document.getElementById('tool-runner');
  els.catalog = document.getElementById('tools-catalog');
  els.filter = document.getElementById('tool-filter');
  els.count = document.getElementById('tool-count');

  await boot({ active: 'tools' });
  initMenus();
  if (els.count) els.count.textContent = String(toolCount());
  renderCatalog();
  els.filter?.addEventListener('input', () => renderCatalog(els.filter.value));
  window.addEventListener('hashchange', route);
  route();
}

function renderCatalog(query = '') {
  const q = query.trim().toLowerCase();
  els.grid.replaceChildren();
  const groups = toolsByCategory();
  let shown = 0;

  groups.forEach((cat) => {
    const tools = cat.tools.filter((t) => !q || t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || t.id.includes(q));
    if (!tools.length) return;
    shown += tools.length;
    const section = document.createElement('section');
    section.className = 'tool-cat';
    section.innerHTML = `<div class="tool-cat-head">
        <h2>${cat.label}</h2><span class="count">${tools.length}</span>
        <span class="muted small">${cat.desc}</span>
      </div>
      <div class="tools-grid"></div>`;
    const grid = section.querySelector('.tools-grid');
    tools.forEach((tool) => {
      const a = document.createElement('a');
      a.className = 'tool-tile';
      a.href = `#${tool.id}`;
      a.innerHTML = `<div class="tt-top"><span class="tt-icon">${icon(tool.icon, 'icon-sm')}</span><span class="tt-name">${tool.name}</span></div>
        <span class="tt-desc">${tool.desc}</span>`;
      grid.append(a);
    });
    els.grid.append(section);
  });

  if (!shown) {
    els.grid.innerHTML = `<div class="empty"><div class="empty-icon">${icon('search')}</div><h3>No tools match “${escapeHtml(query)}”</h3><p>Try “merge”, “convert”, “watermark” or “metadata”.</p></div>`;
  }
}

function route() {
  const id = location.hash.replace('#', '');
  const tool = getTool(id);
  if (!tool) {
    showCatalog();
    return;
  }
  openTool(tool);
}

function showCatalog() {
  els.catalog.hidden = false;
  els.runner.hidden = true;
  S.tool = null;
  document.title = 'PDF Tools — Luma PDF';
}

async function openTool(tool) {
  if (S.running) {
    const ok = await confirmDialog({ title: 'Leave this tool?', message: 'A job is still running. Leaving discards its progress.', confirmLabel: 'Leave' });
    if (!ok) return;
  }
  S.tool = tool;
  S.files = [];
  S.signatureFile = null;
  S.result = null;
  revokeUrls();
  els.catalog.hidden = true;
  els.runner.hidden = false;
  document.title = `${tool.name} — Luma PDF`;
  buildRunner(tool);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildRunner(tool) {
  const accept = tool.inputs?.files || 'pdf';
  const multiple = !!tool.inputs?.multiple;
  const optional = !!tool.inputs?.optional;
  const acceptAttr = accept === 'image' ? 'image/png,image/jpeg,image/webp,image/gif'
    : accept === 'text' ? 'text/plain,.txt,.md,.csv'
      : 'application/pdf,.pdf';

  els.runner.innerHTML = `
    <div class="runner">
      <div class="runner-main">
        <div class="runner-head">
          <a class="back" href="#" aria-label="Back to all tools">${icon('arrow-left')}</a>
          <div>
            <h1>${tool.name}</h1>
            <p>${tool.desc}</p>
          </div>
        </div>

        <div class="card card-pad stack-4">
          ${optional ? `<p class="hint">You can paste text in the options instead of choosing a file.</p>` : ''}
          <div class="dropzone" id="tool-drop" role="button" tabindex="0" aria-label="Choose files">
            <input type="file" id="tool-file" accept="${acceptAttr}" ${multiple ? 'multiple' : ''} aria-hidden="true" tabindex="-1">
            <span class="dz-icon">${icon(accept === 'image' ? 'image' : accept === 'text' ? 'file-text' : 'upload')}</span>
            <span class="dz-title">${multiple ? 'Drop files here or click to browse' : 'Drop a file here or click to browse'}</span>
            <span class="dz-sub">${accept === 'image' ? 'JPG, PNG, WebP or GIF' : accept === 'text' ? 'Plain text (.txt, .md, .csv)' : 'PDF only'}${multiple ? ' · order matters' : ''}</span>
          </div>

          ${tool.inputs?.extraImage ? `<div class="field">
              <label class="label" for="sig-file">Signature image</label>
              <input class="input" type="file" id="sig-file" accept="image/png,image/jpeg,image/webp">
              <span class="hint">A PNG with a transparent background works best.</span>
            </div>` : ''}

          <div id="file-list"></div>
          <div id="param-host" class="opt-group"></div>

          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:4px">
            <button class="btn btn-primary" id="run-btn">${icon('play', 'icon-sm')}Run ${tool.name}</button>
            <button class="btn btn-ghost" id="reset-btn">Reset</button>
            <span class="hint grow" id="run-note">Runs locally — nothing is uploaded.</span>
          </div>
          <div id="progress-host" hidden>
            <div class="progress"><i id="progress-bar" style="width:0%"></i></div>
            <div class="status-line" style="margin-top:8px"><span class="spinner" id="progress-spinner"></span><span id="progress-label">Working…</span></div>
          </div>
        </div>

        <div id="result-host" style="margin-top:16px"></div>
      </div>

      <aside class="runner-side">
        <div class="panel">
          <div class="panel-head"><span class="panel-title">How it works</span></div>
          <div class="panel-body stack-4">
            <p class="small muted" style="line-height:1.6">Luma PDF decodes the file in this tab, edits it with pdf-lib and writes a brand-new file. The original on your disk is never modified.</p>
            <div class="unsupported">${limitationFor(tool)}</div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><span class="panel-title">Related tools</span></div>
          <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:6px">
            ${relatedTools(tool).map((t) => `<a class="chip" href="#${t.id}">${escapeHtml(t.name)}</a>`).join('')}
          </div>
        </div>
      </aside>
    </div>`;

  els.drop = document.getElementById('tool-drop');
  els.fileInput = document.getElementById('tool-file');
  els.fileList = document.getElementById('file-list');
  els.paramHost = document.getElementById('param-host');

  wireDrop(accept, multiple);
  buildParams(tool);
  document.getElementById('run-btn').addEventListener('click', runTool);
  document.getElementById('reset-btn').addEventListener('click', () => { S.files = []; S.signatureFile = null; S.result = null; revokeUrls(); buildRunner(tool); });
  document.getElementById('sig-file')?.addEventListener('change', (e) => {
    S.signatureFile = e.target.files?.[0] || null;
    if (S.signatureFile) toast('Signature image ready', { type: 'success', duration: 1600 });
  });
  renderFileList();
}

function limitationFor(tool) {
  const notes = {
    compress: 'Re-rendering turns text into images: text is no longer selectable and links are dropped. Keep the original if you need them.',
    'reduce-size': 'Very low resolution can make small text unreadable. Check the preview first.',
    'optimize-images': 'Best for image-heavy documents; text-only PDFs may not shrink.',
    crop: 'Crop boxes hide content but do not delete it — a determined reader can restore it.',
    signature: 'This places a signature image. It is not a cryptographic digital signature and carries no certificate.',
    'strip-metadata': 'Some producers embed XMP metadata that pdf-lib cannot remove.',
    'password-check': 'Encrypted files cannot be edited by the other tools until the password is removed.',
    'text-extract': 'Scanned pages have no text layer — OCR is required and is not part of this tool.',
    'pdf-to-text': 'Scanned pages produce no text. Use the viewer’s OCR option for those.',
    'text-to-pdf': 'Standard PDF fonts cover Latin-1 only, so other scripts are replaced with “?”.'
  };
  return notes[tool.id] || 'Every page is processed in memory. Very large documents may be slow on low-memory devices.';
}

function relatedTools(tool) {
  return TOOLS.filter((t) => t.category === tool.category && t.id !== tool.id).slice(0, 4);
}

function buildParams(tool) {
  const params = tool.params || [];
  if (!params.length) {
    els.paramHost.innerHTML = `<p class="hint">This tool has no options — add a file and run it.</p>`;
    return;
  }
  els.paramHost.replaceChildren();
  params.forEach((p) => {
    const wrap = document.createElement('div');
    wrap.className = p.type === 'textarea' ? 'field' : 'opt-row';
    const id = 'p-' + p.key;
    const label = `<label class="label" for="${id}">${escapeHtml(p.label || p.key)}</label>`;
    let control = '';
    if (p.type === 'select') {
      control = `<select class="select" id="${id}">${(p.options || []).map((o) =>
        `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(p.default) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
    } else if (p.type === 'checkbox') {
      wrap.className = 'checkbox';
      control = `<input type="checkbox" id="${id}" ${p.default ? 'checked' : ''}><span>${escapeHtml(p.label || p.key)}</span>`;
      wrap.innerHTML = control + (p.hint ? `<span class="hint" style="margin-left:auto">${escapeHtml(p.hint)}</span>` : '');
      els.paramHost.append(wrap);
      return;
    } else if (p.type === 'textarea') {
      control = `<textarea class="textarea" id="${id}" placeholder="${escapeHtml(p.placeholder || '')}">${escapeHtml(p.default || '')}</textarea>`;
    } else if (p.type === 'color') {
      control = `<input class="input" type="color" id="${id}" value="${escapeHtml(p.default || '#000000')}" style="padding:3px;height:34px">`;
    } else if (p.type === 'number') {
      control = `<input class="input" type="number" id="${id}" value="${escapeHtml(p.default ?? '')}" min="${p.min ?? ''}" max="${p.max ?? ''}">`;
    } else {
      control = `<input class="input" type="text" id="${id}" value="${escapeHtml(p.default ?? '')}" placeholder="${escapeHtml(p.placeholder || '')}">`;
    }
    wrap.innerHTML = `${label}${control}${p.hint ? `<span class="hint" style="grid-column:1/-1">${escapeHtml(p.hint)}</span>` : ''}`;
    els.paramHost.append(wrap);
  });
}

function readParams(tool) {
  const values = {};
  (tool.params || []).forEach((p) => {
    const node = document.getElementById('p-' + p.key);
    if (!node) return;
    values[p.key] = p.type === 'checkbox' ? node.checked : node.value;
  });
  return values;
}

/* ---------------- Files ---------------- */
function wireDrop(accept, multiple) {
  const pick = () => els.fileInput.click();
  els.drop.addEventListener('click', (e) => { if (e.target !== els.fileInput) pick(); });
  els.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  els.fileInput.addEventListener('change', () => {
    const files = Array.from(els.fileInput.files || []);
    els.fileInput.value = '';
    if (files.length) addFiles(files, accept, multiple);
  });
  ['dragenter', 'dragover'].forEach((t) => els.drop.addEventListener(t, (e) => { e.preventDefault(); els.drop.classList.add('is-dragover'); }));
  ['dragleave', 'dragend'].forEach((t) => els.drop.addEventListener(t, (e) => { if (e.target === els.drop) els.drop.classList.remove('is-dragover'); }));
  els.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    els.drop.classList.remove('is-dragover');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) addFiles(files, accept, multiple);
  });
}

function addFiles(files, accept, multiple) {
  const accepted = files.filter((f) => {
    if (accept === 'pdf') return isPdfFile(f);
    if (accept === 'image') return /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
    return /^text\//.test(f.type) || /\.(txt|md|csv|text)$/i.test(f.name);
  });
  if (accepted.length !== files.length) {
    toast(`${files.length - accepted.length} file(s) skipped — wrong type for this tool.`, { type: 'warn' });
  }
  if (!accepted.length) return;
  if (multiple) S.files = [...S.files, ...accepted];
  else S.files = [accepted[0]];
  renderFileList();
}

function renderFileList() {
  if (!els.fileList) return;
  if (!S.files.length) {
    els.fileList.innerHTML = '';
    return;
  }
  els.fileList.innerHTML = S.files.map((f, i) => `
    <div class="file-row" data-index="${i}" draggable="true">
      <span class="fr-icon">${icon(isPdfFile(f) ? 'file-text' : /^image/.test(f.type) ? 'image' : 'file', 'icon-sm')}</span>
      <div class="grow">
        <div class="fr-name truncate">${escapeHtml(f.name)}</div>
        <div class="fr-meta">${formatBytes(f.size)}${i === 0 && S.files.length > 1 ? ' · first in output' : ''}</div>
      </div>
      <button class="btn btn-ghost btn-icon btn-sm" data-up="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('chevron-up', 'icon-sm')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-down="${i}" aria-label="Move down" ${i === S.files.length - 1 ? 'disabled' : ''}>${icon('chevron-down', 'icon-sm')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-remove="${i}" aria-label="Remove file">${icon('x', 'icon-sm')}</button>
    </div>`).join('');

  els.fileList.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    S.files.splice(Number(b.dataset.remove), 1);
    renderFileList();
  }));
  els.fileList.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.up);
    [S.files[i - 1], S.files[i]] = [S.files[i], S.files[i - 1]];
    renderFileList();
  }));
  els.fileList.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.down);
    [S.files[i + 1], S.files[i]] = [S.files[i], S.files[i + 1]];
    renderFileList();
  }));

  // Drag to reorder
  let dragIndex = null;
  els.fileList.querySelectorAll('.file-row').forEach((row) => {
    row.addEventListener('dragstart', () => { dragIndex = Number(row.dataset.index); row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-target'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop-target');
      const target = Number(row.dataset.index);
      if (dragIndex === null || dragIndex === target) return;
      const [moved] = S.files.splice(dragIndex, 1);
      S.files.splice(target, 0, moved);
      dragIndex = null;
      renderFileList();
    });
  });
}

/* ---------------- Run ---------------- */
async function runTool() {
  const tool = S.tool;
  if (!tool || S.running) return;
  const minFiles = tool.inputs?.min ?? 1;
  if (tool.inputs?.optional) {
    const values = readParams(tool);
    if (!S.files.length && !String(values.text || '').trim()) {
      toast('Add a file or paste some text first.', { type: 'warn' });
      return;
    }
  } else if (S.files.length < minFiles) {
    toast(`This tool needs ${minFiles > 1 ? 'at least ' + minFiles + ' files' : 'a file'}.`, { type: 'warn' });
    return;
  }

  const destructive = ['delete-pages', 'strip-metadata', 'crop'].includes(tool.id);
  if (tool.id === 'delete-pages') {
    const values = readParams(tool);
    const ok = await confirmDialog({
      title: 'Delete these pages?',
      message: `Pages “${values.pages || '(none)'}” will be removed from the copy Luma PDF creates. Your original file is untouched.`,
      confirmLabel: 'Delete pages',
      danger: true
    });
    if (!ok) return;
  }

  S.running = true;
  const runBtn = document.getElementById('run-btn');
  setBusy(runBtn, true, 'Working');
  const progressHost = document.getElementById('progress-host');
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');
  progressHost.hidden = false;
  bar.style.width = '4%';
  label.textContent = 'Starting…';
  document.getElementById('result-host').replaceChildren();

  const values = readParams(tool);
  try {
    const result = await tool.run({
      files: S.files,
      values,
      signatureFile: S.signatureFile,
      progress: (ratio, message) => {
        bar.style.width = `${Math.max(4, Math.min(100, Math.round((ratio || 0) * 100)))}%`;
        if (message) label.textContent = message;
      }
    });
    S.result = result;
    bar.style.width = '100%';
    label.textContent = 'Done';
    renderResult(result, tool);
    toast(result.summary || 'Finished', { type: 'success', duration: 4000 });
  } catch (err) {
    console.error(err);
    bar.style.width = '100%';
    label.textContent = 'Failed';
    document.getElementById('result-host').innerHTML = `
      <div class="result-box" style="border-color:color-mix(in srgb, var(--danger) 40%, transparent)">
        <div class="rb-icon" style="background:var(--danger-soft);color:var(--danger)">${icon('alert')}</div>
        <h3>That did not work</h3>
        <p>${escapeHtml(err.message || String(err))}</p>
        <p class="hint" style="margin-top:8px">Nothing was uploaded and your original file was not changed.</p>
      </div>`;
    toast(err.message || 'The tool failed', { type: 'error', duration: 7000 });
  } finally {
    S.running = false;
    setBusy(runBtn, false);
    setTimeout(() => { progressHost.hidden = true; }, 900);
  }
}

function revokeUrls() {
  S.urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* ignore */ } });
  S.urls = [];
}

function makeUrl(blob) {
  const url = URL.createObjectURL(blob);
  S.urls.push(url);
  return url;
}

function renderResult(result, tool) {
  const host = document.getElementById('result-host');
  const size = result.blob?.size || 0;
  let previewHtml = '';
  if (result.preview?.kind === 'pdf' && result.blob) {
    const url = makeUrl(result.blob);
    previewHtml = `<div class="row-between" style="margin-top:14px">
        <span class="small muted">Preview</span>
        <a class="small" href="${url}" target="_blank" rel="noopener">Open in a new tab</a>
      </div>
      <div class="preview-frame" style="margin-top:6px"><iframe title="Result preview" src="${url}"></iframe></div>
      <p class="hint" style="margin-top:6px">The preview uses your browser's built-in PDF viewer. If it stays blank, download the file and open it locally.</p>`;
  } else if (result.preview?.kind === 'image' && result.preview.blob) {
    previewHtml = `<div class="preview-frame" style="height:auto;padding:10px;text-align:center;background:var(--bg-sunken)">
      <img src="${makeUrl(result.preview.blob)}" alt="Result preview" style="max-height:400px;width:auto;margin:0 auto;box-shadow:var(--shadow-sm)"></div>`;
  } else if (result.preview?.kind === 'text') {
    previewHtml = `<div class="codeblock" style="margin-top:12px"><button class="copy-code" data-copy-text>Copy</button>
      <pre style="max-height:300px">${escapeHtml(result.preview.text || '')}</pre></div>`;
  } else if (result.preview?.kind === 'list') {
    previewHtml = `<div class="preview-thumbs" style="margin-top:12px">${(result.preview.items || []).slice(0, 24).map((it) =>
      `<div class="preview-thumb"><div class="small truncate" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
       <div class="muted" style="font-size:10.5px">${formatBytes(it.size)}</div></div>`).join('')}</div>`;
  }

  host.innerHTML = `
    <div class="result-box">
      <div class="rb-icon">${icon('check')}</div>
      <h3>${escapeHtml(result.summary || 'Finished')}</h3>
      <p>${escapeHtml(result.filename || 'file')}${size ? ' · ' + formatBytes(size) : ''}</p>
      ${(result.details || []).length ? `<ul style="margin:10px 0 0;padding-left:16px;list-style:disc;font-size:12.5px;color:var(--text-muted);line-height:1.6">
        ${result.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : ''}
      <div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="download-result">${icon('download', 'icon-sm')}Download</button>
        <button class="btn btn-outline" id="again-btn">Run again</button>
      </div>
      ${previewHtml}
    </div>`;

  document.getElementById('download-result').addEventListener('click', () => {
    downloadBlob(result.blob, result.filename || 'result');
    toast('Download started', { type: 'success', duration: 2000 });
  });
  document.getElementById('again-btn').addEventListener('click', () => {
    revokeUrls();
    document.getElementById('result-host').replaceChildren();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  host.querySelector('[data-copy-text]')?.addEventListener('click', async () => {
    const ok = await navigator.clipboard?.writeText(result.preview.text || '').then(() => true).catch(() => false);
    toast(ok ? 'Copied' : 'Copy blocked by the browser', { type: ok ? 'success' : 'error', duration: 1600 });
  });
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch((e) => {
  console.error(e);
  toast('The tools page failed to start: ' + e.message, { type: 'error', duration: 8000 });
});
