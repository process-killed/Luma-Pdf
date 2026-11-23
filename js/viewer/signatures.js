/**
 * Signature library — draw, type or upload a signature, keep a few of them in this
 * browser, and place the chosen one on the page.
 *
 * Images are trimmed to their ink and white backgrounds are made transparent, so a
 * photo of a signature on paper still looks clean on the document.
 */
import { dialog, toast } from '../ui/ui.js';
import { readAsDataURL } from '../utils/files.js';

const STORE_KEY = 'luma.signatures.v1';
const MAX_SAVED = 8;
const TYPED_FONTS = [
  { id: 'cursive', label: 'Script', css: '"Segoe Script", "Bradley Hand", "Brush Script MT", cursive' },
  { id: 'serif', label: 'Classic', css: 'Georgia, "Times New Roman", serif' },
  { id: 'sans', label: 'Modern', css: 'system-ui, "Segoe UI", Helvetica, Arial, sans-serif' }
];

export function loadSavedSignatures() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((s) => s && s.dataUrl).slice(0, MAX_SAVED) : [];
  } catch { return []; }
}

function persist(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch {
    toast('This browser will not store more signatures — delete one first.', { type: 'warn' });
  }
}

function saveSignature(dataUrl) {
  const list = loadSavedSignatures().filter((s) => s.dataUrl !== dataUrl);
  list.unshift({ id: 'sig-' + Date.now().toString(36), dataUrl, createdAt: Date.now() });
  persist(list);
}

function removeSignature(id) {
  persist(loadSavedSignatures().filter((s) => s.id !== id));
}

/** Crop to the ink and make near-white pixels transparent. */
function cleanCanvas(canvas, { keepWhite = false } = {}) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height);
  const px = data.data;
  let minX = width, minY = height, maxX = -1, maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
      if (a === 0) continue;
      if (!keepWhite && r > 235 && g > 235 && b > 235) { px[i + 3] = 0; continue; }
      if (r < minX) minX = x;
      if (r < 0) { /* noop */ }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  ctx.putImageData(data, 0, 0);
  if (maxX < 0) return canvas;
  const pad = 4;
  const w = Math.min(width, maxX - minX + 1 + pad * 2);
  const h = Math.min(height, maxY - minY + 1 + pad * 2);
  const out = document.createElement('canvas');
  out.width = Math.max(1, w);
  out.height = Math.max(1, h);
  out.getContext('2d').drawImage(
    canvas,
    Math.max(0, minX - pad), Math.max(0, minY - pad), w, h,
    0, 0, w, h
  );
  return out;
}

function typedSignature(text, fontCss) {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  let size = 120;
  ctx.font = `italic ${size}px ${fontCss}`;
  while (ctx.measureText(text).width > canvas.width - 80 && size > 40) {
    size -= 6;
    ctx.font = `italic ${size}px ${fontCss}`;
  }
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return cleanCanvas(canvas);
}

export function openSignatureLibrary({ onPick } = {}) {
  const body = document.createElement('div');
  body.className = 'sig-library';
  body.innerHTML = `
    <div class="segmented" role="tablist" style="margin-bottom:14px">
      <button role="tab" aria-pressed="true" data-tab="draw">Draw</button>
      <button role="tab" aria-pressed="false" data-tab="type">Type</button>
      <button role="tab" aria-pressed="false" data-tab="upload">Upload</button>
      <button role="tab" aria-pressed="false" data-tab="saved">Saved</button>
    </div>
    <div class="sig-pane" data-pane="draw">
      <p class="hint" style="margin-bottom:8px">Sign with a mouse, stylus or finger.</p>
      <div class="sig-pad"><canvas id="sig-canvas" width="760" height="260"></canvas><div class="sig-baseline"></div></div>
      <div class="row" style="margin-top:10px;gap:8px">
        <button class="btn btn-ghost btn-sm" id="sig-clear">Clear</button>
        <label class="row small muted" style="gap:6px">Ink
          <input type="range" id="sig-width" min="1.5" max="6" step="0.5" value="2.5" aria-label="Ink thickness">
        </label>
      </div>
    </div>
    <div class="sig-pane" data-pane="type" hidden>
      <div class="field"><label class="label" for="sig-text">Name to sign</label>
        <input class="input" id="sig-text" placeholder="Your name" autocomplete="off"></div>
      <div class="field" style="margin-top:10px"><label class="label" for="sig-font">Style</label>
        <select class="select" id="sig-font">${TYPED_FONTS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('')}</select></div>
      <div class="sig-preview" id="sig-preview"></div>
    </div>
    <div class="sig-pane" data-pane="upload" hidden>
      <div class="field"><label class="label" for="sig-file">Image of your signature</label>
        <input class="input" type="file" id="sig-file" accept="image/png,image/jpeg,image/webp">
        <span class="hint">A photo works: the white background is removed automatically.</span></div>
      <div class="sig-preview" id="sig-upload-preview"></div>
    </div>
    <div class="sig-pane" data-pane="saved" hidden>
      <div class="sig-saved" id="sig-saved"></div>
    </div>`;

  let draft = null;       // { dataUrl, width, height }
  let activeTab = 'draw';

  const dialogPromise = dialog({
    title: 'Signatures',
    sub: 'Draw, type or upload — then place it on the page.',
    body,
    width: '620px',
    actions: [
      { label: 'Cancel', value: null, variant: 'ghost' },
      {
        label: 'Use signature',
        value: 'ok',
        variant: 'primary',
        onClick: () => {
          if (activeTab === 'draw') {
            const canvas = document.querySelector('#sig-canvas');
            if (canvas) {
              const cleaned = cleanCanvas(canvas);
              if (cleaned.width > 8 && cleaned.height > 8) {
                draft = { dataUrl: cleaned.toDataURL('image/png'), width: cleaned.width, height: cleaned.height };
              }
            }
          }
          if (!draft) { toast('Create or pick a signature first.', { type: 'warn' }); return false; }
          saveSignature(draft.dataUrl);
          onPick?.(draft);
          return true;
        }
      }
    ],
    onMount: (dlg) => {
      const canvas = dlg.querySelector('#sig-canvas');
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2.5;
      let drawing = false;
      let last = null;
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return {
          x: ((e.clientX - r.left) / r.width) * canvas.width,
          y: ((e.clientY - r.top) / r.height) * canvas.height
        };
      };
      canvas.addEventListener('pointerdown', (e) => {
        drawing = true;
        last = pos(e);
        canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = pos(e);
        const pressure = e.pressure && e.pressure > 0 && e.pointerType === 'pen' ? e.pressure : 0.5;
        ctx.lineWidth = Number(dlg.querySelector('#sig-width').value) * (0.7 + pressure * 0.9);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last = p;
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, () => { drawing = false; }));
      dlg.querySelector('#sig-clear').addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        draft = null;
      });

      // typed signatures
      const textInput = dlg.querySelector('#sig-text');
      const fontSelect = dlg.querySelector('#sig-font');
      const preview = dlg.querySelector('#sig-preview');
      const refreshTyped = () => {
        const text = textInput.value.trim();
        if (!text) { preview.innerHTML = ''; draft = null; return; }
        const font = TYPED_FONTS.find((f) => f.id === fontSelect.value) || TYPED_FONTS[0];
        const clean = typedSignature(text, font.css);
        const url = clean.toDataURL('image/png');
        draft = { dataUrl: url, width: clean.width, height: clean.height };
        preview.innerHTML = `<img src="${url}" alt="Typed signature preview">`;
      };
      textInput.addEventListener('input', refreshTyped);
      fontSelect.addEventListener('change', refreshTyped);

      // uploads
      dlg.querySelector('#sig-file').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const url = await readAsDataURL(file);
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
          const canvas2 = document.createElement('canvas');
          canvas2.width = img.naturalWidth;
          canvas2.height = img.naturalHeight;
          canvas2.getContext('2d').drawImage(img, 0, 0);
          const clean = cleanCanvas(canvas2);
          const dataUrl = clean.toDataURL('image/png');
          draft = { dataUrl, width: clean.width, height: clean.height };
          dlg.querySelector('#sig-upload-preview').innerHTML = `<img src="${dataUrl}" alt="Uploaded signature preview">`;
        } catch {
          toast('That image could not be read.', { type: 'error' });
        }
      });

      // saved signatures
      const paintSaved = () => {
        const host = dlg.querySelector('#sig-saved');
        const saved = loadSavedSignatures();
        if (!saved.length) {
          host.innerHTML = `<p class="hint">Nothing saved yet. Signatures you use are kept in this browser for next time.</p>`;
          return;
        }
        host.innerHTML = saved.map((s) => `
          <div class="sig-saved-item" data-id="${s.id}">
            <button class="sig-saved-pick" data-pick="${s.id}" aria-label="Use this signature"><img src="${s.dataUrl}" alt="Saved signature"></button>
            <button class="sig-saved-del" data-del="${s.id}" aria-label="Delete this signature">×</button>
          </div>`).join('');
        host.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => {
          const item = saved.find((s) => s.id === btn.dataset.pick);
          if (!item) return;
          draft = { dataUrl: item.dataUrl, width: 600, height: 200 };
          dlg.querySelector('.modal-foot .btn-primary').click();
        }));
        host.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => {
          removeSignature(btn.dataset.del);
          paintSaved();
        }));
      };
      paintSaved();

      // tabs
      dlg.querySelectorAll('[data-tab]').forEach((tab) => {
        tab.addEventListener('click', () => {
          activeTab = tab.dataset.tab;
          dlg.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-pressed', String(t === tab)));
          dlg.querySelectorAll('.sig-pane').forEach((pane) => { pane.hidden = pane.dataset.pane !== activeTab; });
          if (activeTab === 'saved') paintSaved();
          if (activeTab === 'draw' && !draft) draft = null;
        });
      });

    }
  });

  return dialogPromise;
}
