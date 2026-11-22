// Image / signature overlay dialog for the editor.
import { dialog, toast } from '../ui/ui.js';
import { readAsDataURL } from '../utils/files.js';

const POSITIONS = [
  ['center', 'Centre'], ['top-left', 'Top left'], ['top-right', 'Top right'],
  ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']
];

export async function addImageOverlay(editor, { selection }) {
  const body = document.createElement('div');
  body.className = 'stack-4';
  body.innerHTML = `
    <div class="field">
      <label class="label" for="im-file">Image or signature</label>
      <input class="input" id="im-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
      <span class="hint">A PNG with transparency works best for signatures and logos.</span>
    </div>
    <div class="grid grid-2" style="gap:12px">
      <div class="field"><label class="label" for="im-position">Position</label>
        <select class="select" id="im-position">${POSITIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="field"><label class="label" for="im-width">Width (pt)</label>
        <input class="input" id="im-width" type="number" value="160" min="24" max="600"></div>
      <div class="field"><label class="label" for="im-opacity">Opacity (%)</label>
        <input class="input" id="im-opacity" type="number" value="100" min="10" max="100"></div>
      <div class="field"><label class="label" for="im-target">Apply to</label>
        <select class="select" id="im-target">
          <option value="all">Every page</option>
          <option value="selection" ${selection?.count ? '' : 'disabled'}>Selected pages (${selection?.count || 0})</option>
        </select></div>
    </div>
    <div id="im-preview" class="hint"></div>`;

  let dataUrl = null;
  let dimensions = null;
  body.querySelector('#im-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    dataUrl = await readAsDataURL(file);
    const img = new Image();
    img.onload = () => {
      dimensions = { width: img.width, height: img.height };
      body.querySelector('#im-preview').innerHTML = `<img src="${dataUrl}" alt="Preview" style="max-height:90px;border:1px solid var(--surface-border);border-radius:6px;padding:4px;background:#fff">`;
    };
    img.src = dataUrl;
  });

  const ok = await dialog({
    title: 'Add image',
    sub: 'Placed on the exported PDF.',
    body,
    width: '520px',
    actions: [
      { label: 'Cancel', value: false, variant: 'ghost' },
      { label: 'Add image', value: true, variant: 'primary', onClick: () => !!dataUrl }
    ]
  });
  if (!ok) return null;

  const overlay = {
    kind: 'image',
    dataUrl,
    dimensions,
    position: body.querySelector('#im-position').value,
    width: Number(body.querySelector('#im-width').value) || 160,
    opacity: (Number(body.querySelector('#im-opacity').value) || 100) / 100,
    pages: body.querySelector('#im-target').value === 'selection' && selection?.count ? selection.numbers : 'all'
  };
  editor.addOverlay(overlay);
  toast('Image will be added on export', { type: 'success', duration: 2200 });
  return overlay;
}
