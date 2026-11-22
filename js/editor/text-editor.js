// Add-text overlay dialog for the editor.
import { dialog, toast } from '../ui/ui.js';
import { readAsDataURL } from '../utils/files.js';

const POSITIONS = [
  ['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'],
  ['center', 'Centre'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right']
];

export async function addTextOverlay(editor, { selection }) {
  const body = document.createElement('div');
  body.className = 'stack-4';
  body.innerHTML = `
    <div class="field">
      <label class="label" for="tx-text">Text</label>
      <textarea class="textarea" id="tx-text" placeholder="Text to place on the page…"></textarea>
    </div>
    <div class="grid grid-2" style="gap:12px">
      <div class="field">
        <label class="label" for="tx-position">Position</label>
        <select class="select" id="tx-position">${POSITIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label class="label" for="tx-size">Font size</label>
        <input class="input" id="tx-size" type="number" value="16" min="6" max="96">
      </div>
      <div class="field">
        <label class="label" for="tx-color">Colour</label>
        <input class="input" id="tx-color" type="color" value="#111111" style="padding:3px;height:34px">
      </div>
      <div class="field">
        <label class="label" for="tx-bg">Background</label>
        <input class="input" id="tx-bg" type="color" value="#ffffff" style="padding:3px;height:34px">
      </div>
    </div>
    <label class="checkbox"><input type="checkbox" id="tx-bg-on"> Draw a background box behind the text</label>
    <label class="checkbox"><input type="checkbox" id="tx-bold"> Bold</label>
    <div class="field">
      <label class="label" for="tx-target">Apply to</label>
      <select class="select" id="tx-target">
        <option value="all">Every page</option>
        <option value="selection" ${selection?.count ? '' : 'disabled'}>Selected pages (${selection?.count || 0})</option>
      </select>
      <span class="hint">The text is added to the exported copy, not to the original.</span>
    </div>`;

  const ok = await dialog({
    title: 'Add text',
    sub: 'Place text on the exported PDF.',
    body,
    width: '520px',
    actions: [
      { label: 'Cancel', value: false, variant: 'ghost' },
      { label: 'Add text', value: true, variant: 'primary', onClick: (dlg) => !!dlg.querySelector('#tx-text').value.trim() }
    ]
  });
  if (!ok) return null;

  const overlay = {
    kind: 'text',
    text: body.querySelector('#tx-text').value,
    position: body.querySelector('#tx-position').value,
    size: Number(body.querySelector('#tx-size').value) || 16,
    color: body.querySelector('#tx-color').value,
    bold: body.querySelector('#tx-bold').checked,
    background: body.querySelector('#tx-bg-on').checked ? body.querySelector('#tx-bg').value : null,
    pages: body.querySelector('#tx-target').value === 'selection' && selection?.count
      ? selection.numbers
      : 'all'
  };
  editor.addOverlay(overlay);
  toast('Text will be added on export', { type: 'success', duration: 2200 });
  return overlay;
}

export async function addWatermarkOverlay(editor) {
  const body = document.createElement('div');
  body.className = 'stack-4';
  body.innerHTML = `
    <div class="field">
      <label class="label" for="wm-text">Watermark text</label>
      <input class="input" id="wm-text" value="CONFIDENTIAL">
    </div>
    <div class="grid grid-2" style="gap:12px">
      <div class="field"><label class="label" for="wm-size">Size</label>
        <input class="input" id="wm-size" type="number" value="48" min="8" max="160"></div>
      <div class="field"><label class="label" for="wm-opacity">Opacity (%)</label>
        <input class="input" id="wm-opacity" type="number" value="14" min="2" max="100"></div>
      <div class="field"><label class="label" for="wm-angle">Angle</label>
        <select class="select" id="wm-angle"><option value="45">45°</option><option value="0">0°</option><option value="90">90°</option></select></div>
      <div class="field"><label class="label" for="wm-color">Colour</label>
        <input class="input" id="wm-color" type="color" value="#8b8b9a" style="padding:3px;height:34px"></div>
    </div>`;
  const ok = await dialog({
    title: 'Add watermark',
    body,
    actions: [{ label: 'Cancel', value: false, variant: 'ghost' }, { label: 'Add watermark', value: true, variant: 'primary' }]
  });
  if (!ok) return null;
  const overlay = {
    kind: 'watermark',
    text: body.querySelector('#wm-text').value || 'DRAFT',
    size: Number(body.querySelector('#wm-size').value) || 48,
    opacity: Number(body.querySelector('#wm-opacity').value) || 14,
    angle: Number(body.querySelector('#wm-angle').value) || 0,
    color: body.querySelector('#wm-color').value,
    pages: 'all'
  };
  editor.addOverlay(overlay);
  toast('Watermark will be applied on export', { type: 'success', duration: 2200 });
  return overlay;
}

export async function addPageNumbersOverlay(editor) {
  const body = document.createElement('div');
  body.className = 'stack-4';
  body.innerHTML = `
    <div class="grid grid-2" style="gap:12px">
      <div class="field"><label class="label" for="pn-format">Format</label>
        <select class="select" id="pn-format">
          <option value="{n}">{n}</option>
          <option value="{n} / {total}" selected>{n} / {total}</option>
          <option value="Page {n}">Page {n}</option>
          <option value="Page {n} of {total}">Page {n} of {total}</option>
        </select></div>
      <div class="field"><label class="label" for="pn-position">Position</label>
        <select class="select" id="pn-position">${POSITIONS.map(([v, l]) => `<option value="${v}" ${v === 'bottom-center' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label class="label" for="pn-size">Font size</label>
        <input class="input" id="pn-size" type="number" value="10" min="6" max="24"></div>
      <div class="field"><label class="label" for="pn-color">Colour</label>
        <input class="input" id="pn-color" type="color" value="#55555f" style="padding:3px;height:34px"></div>
    </div>
    <p class="hint">Numbers follow the exported page order.</p>`;
  const ok = await dialog({
    title: 'Add page numbers',
    body,
    actions: [{ label: 'Cancel', value: false, variant: 'ghost' }, { label: 'Add numbers', value: true, variant: 'primary' }]
  });
  if (!ok) return null;
  const overlay = {
    kind: 'pageNumbers',
    format: body.querySelector('#pn-format').value,
    position: body.querySelector('#pn-position').value,
    size: Number(body.querySelector('#pn-size').value) || 10,
    color: body.querySelector('#pn-color').value,
    pages: 'all'
  };
  editor.addOverlay(overlay);
  toast('Page numbers will be applied on export', { type: 'success', duration: 2200 });
  return overlay;
}

export async function pickTextFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'text/plain,.txt,.md,.csv';
  return new Promise((resolve) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve(await readAsDataURL(file).then(() => file));
    });
    input.click();
  });
}
