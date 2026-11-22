/**
 * Embed Generator — configure the viewer, preview it live, copy the snippet.
 */
import { boot } from '../app.js';
import { EMBED_PARAMS, EMBED_PRESETS } from '../config.js';
import { serializeEmbedConfig, iframeSnippet, EMBED_DEFAULTS } from '../embed/config.js';
import { icon } from '../ui/icons.js';
import { toast, attachCopyButtons, initMenus } from '../ui/ui.js';
import { normalizeUrl, absoluteAppUrl } from '../utils/urls.js';

const S = { cfg: { ...EMBED_DEFAULTS }, file: '', previewUrl: '', timer: 0 };

const els = {};

async function main() {
  els.controls = document.getElementById('gen-controls');
  els.frame = document.getElementById('gen-frame');
  els.url = document.getElementById('gen-url');
  els.code = document.getElementById('gen-code');
  els.status = document.getElementById('gen-status');

  await boot({ active: 'embed' });
  initMenus();

  const params = new URLSearchParams(location.search);
  if (params.get('file')) S.file = params.get('file');

  buildControls();
  renderPresets();
  wireTop();
  update({ preview: true });
  attachCopyButtons(document);
}

function wireTop() {
  const input = document.getElementById('gen-file');
  input.value = S.file;
  input.addEventListener('input', () => {
    S.file = input.value.trim();
    update({ preview: false });
  });
  document.getElementById('gen-apply').addEventListener('click', () => update({ preview: true }));
  document.getElementById('gen-reset').addEventListener('click', () => {
    S.cfg = { ...EMBED_DEFAULTS };
    S.file = '';
    document.getElementById('gen-file').value = '';
    buildControls();
    update({ preview: true });
    toast('Settings reset', { duration: 1600 });
  });
  document.getElementById('gen-open').addEventListener('click', () => {
    if (!S.previewUrl) { toast('Enter a PDF URL first.', { type: 'warn' }); return; }
    window.open(S.previewUrl, '_blank', 'noopener');
  });
  document.getElementById('gen-snippet-style').addEventListener('change', () => update({ preview: false }));
}

function renderPresets() {
  const host = document.getElementById('gen-presets');
  host.innerHTML = Object.keys(EMBED_PRESETS).map((key) =>
    `<button class="chip" data-preset="${key}">${labelFor(key)}</button>`).join('');
  host.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = EMBED_PRESETS[btn.dataset.preset];
      S.cfg = { ...EMBED_DEFAULTS, ...normalisePreset(preset) };
      buildControls();
      update({ preview: true });
      host.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === btn)));
      toast(`${labelFor(btn.dataset.preset)} preset applied`, { duration: 1600 });
    });
  });
}

function normalisePreset(preset) {
  const out = {};
  for (const [k, v] of Object.entries(preset)) {
    if (typeof v === 'number' && (v === 0 || v === 1) && typeof EMBED_DEFAULTS[k] === 'boolean') out[k] = !!v;
    else out[k] = v;
  }
  return out;
}

function labelFor(key) {
  return { minimal: 'Minimal', professional: 'Professional', reading: 'Reading', dark: 'Dark', mobile: 'Mobile', docs: 'Documentation', presentation: 'Presentation' }[key] || key;
}

function buildControls() {
  const groups = new Map();
  EMBED_PARAMS.forEach((p) => {
    if (p.key === 'file') return;
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  });

  els.controls.replaceChildren();
  groups.forEach((params, group) => {
    const section = document.createElement('div');
    section.className = 'panel';
    section.innerHTML = `<div class="panel-head" style="padding:10px 14px"><span class="panel-title" style="font-size:13px">${group}</span></div>
      <div class="panel-body stack-4" style="padding:12px 14px"></div>`;
    const body = section.querySelector('.panel-body');
    params.forEach((p) => body.append(controlFor(p)));
    els.controls.append(section);
  });
}

function controlFor(p) {
  const row = document.createElement('div');
  row.className = 'row-between';
  row.style.gap = '10px';
  const current = S.cfg[p.key];

  if (p.type === 'bool') {
    row.innerHTML = `<label class="switch" style="flex:1" title="${escapeHtml(p.desc)}">
        <input type="checkbox" data-key="${p.key}" ${current ? 'checked' : ''}>
        <span class="track"></span>
        <span>${escapeHtml(p.label)}</span>
      </label>`;
    row.querySelector('input').addEventListener('change', (e) => {
      S.cfg[p.key] = e.target.checked;
      update({ preview: false });
    });
    return row;
  }

  if (p.type === 'enum') {
    row.innerHTML = `<label class="label" for="gen-${p.key}" style="flex:1">${escapeHtml(p.label)}</label>
      <select class="select" id="gen-${p.key}" data-key="${p.key}" style="max-width:150px">
        ${p.values.map((v) => `<option value="${v}" ${String(current) === String(v) ? 'selected' : ''}>${v}</option>`).join('')}
      </select>`;
    row.querySelector('select').addEventListener('change', (e) => {
      S.cfg[p.key] = e.target.value;
      update({ preview: false });
    });
    return row;
  }

  if (p.type === 'int') {
    row.innerHTML = `<label class="label" for="gen-${p.key}" style="flex:1">${escapeHtml(p.label)}</label>
      <input class="input input-sm" id="gen-${p.key}" data-key="${p.key}" type="number" min="${p.min || 1}" value="${current ?? 1}" style="max-width:90px">`;
    row.querySelector('input').addEventListener('input', (e) => {
      S.cfg[p.key] = Number(e.target.value) || 1;
      update({ preview: false });
    });
    return row;
  }

  row.innerHTML = `<label class="label" for="gen-${p.key}" style="flex:1">${escapeHtml(p.label)}</label>
    <input class="input input-sm" id="gen-${p.key}" data-key="${p.key}" type="text" value="${escapeHtml(current ?? '')}" style="max-width:170px">`;
  row.querySelector('input').addEventListener('input', (e) => {
    S.cfg[p.key] = e.target.value;
    update({ preview: false });
  });
  return row;
}

function buildUrl() {
  const file = S.file ? (normalizeUrl(S.file, location.href) || S.file) : '';
  const params = serializeEmbedConfig(S.cfg, { file });
  const base = absoluteAppUrl('embed.html');
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

function update({ preview }) {
  S.previewUrl = buildUrl();
  els.url.textContent = S.previewUrl;

  const style = document.getElementById('gen-snippet-style').value;
  const snippetOpts = {
    responsive: { width: '100%', height: '700' },
    fixed: { width: '800', height: '600' },
    fullscreen: { width: '100%', height: '100%', lazy: false },
    minimal: { width: '100%', height: '420' }
  }[style] || { width: '100%', height: '700' };
  els.code.textContent = iframeSnippet(S.previewUrl, snippetOpts);

  const valid = !!S.file && !!normalizeUrl(S.file, location.href);
  els.status.innerHTML = valid
    ? `<span style="color:var(--success)">●</span> ${escapeHtml(shortUrl(S.file))}`
    : `<span style="color:var(--warning)">●</span> Enter the full URL of a PDF to preview it`;

  if (preview && valid) {
    clearTimeout(S.timer);
    S.timer = setTimeout(() => {
      els.frame.innerHTML = `<iframe src="${S.previewUrl}" title="Luma PDF preview" allowfullscreen></iframe>`;
    }, 250);
  } else if (preview && !valid) {
    els.frame.innerHTML = `<div class="embed-fallback">The preview appears once you enter a PDF URL.<br><br>
      Tip: the PDF must be publicly reachable and served with CORS headers.</div>`;
  }
}

function shortUrl(url) {
  try {
    const u = new URL(url, location.href);
    return u.host + (u.pathname.length > 28 ? u.pathname.slice(0, 28) + '…' : u.pathname);
  } catch { return url; }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch((e) => {
  console.error(e);
  toast('The generator failed to start: ' + e.message, { type: 'error' });
});
