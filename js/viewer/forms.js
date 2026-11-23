/**
 * AcroForm support — detect interactive fields, fill them on the page, and write
 * the values into a new PDF (optionally flattened so every reader shows them).
 *
 * The overlay uses the same page-unit + CSS-transform approach as annotations, so a
 * zoom never rebuilds the inputs.
 */
import { toast } from '../ui/ui.js';

/**
 * Field kinds. pdf-lib's minified build renames classes, so `instanceof` against the
 * exported constructors (not `constructor.name`) is what identifies a field.
 */
function kindOf(field) {
  const L = window.PDFLib || {};
  if (L.PDFTextField && field instanceof L.PDFTextField) return 'text';
  if (L.PDFCheckBox && field instanceof L.PDFCheckBox) return 'checkbox';
  if (L.PDFRadioGroup && field instanceof L.PDFRadioGroup) return 'radio';
  if ((L.PDFDropdown && field instanceof L.PDFDropdown) || (L.PDFOptionList && field instanceof L.PDFOptionList)) return 'choice';
  if (L.PDFSignature && field instanceof L.PDFSignature) return 'signature';
  // Structural fallback if the constructors are not exported by a future build.
  if (typeof field.isChecked === 'function') return 'checkbox';
  if (typeof field.getText === 'function') return 'text';
  if (typeof field.select === 'function' && typeof field.getOptions === 'function') return 'choice';
  return 'unknown';
}

export class FormLayer {
  constructor({ viewer, onChange }) {
    this.viewer = viewer;
    this.onChange = onChange || (() => {});
    this.fields = [];
    this.byPage = new Map();
    this.values = new Map();
    this.visible = false;
    this.doc = null;
    this.bytes = null;
    this.layers = new Map();
    this.dirty = false;
  }

  get count() { return this.fields.length; }
  get hasFields() { return this.fields.length > 0; }
  get filledCount() {
    let n = 0;
    for (const [, v] of this.values) {
      if (v === true || (typeof v === 'string' && v.trim())) n++;
    }
    return n;
  }

  /** Parse the form definition. Returns the number of fields found. */
  async load(bytes) {
    this.bytes = bytes;
    const PDFLib = window.PDFLib;
    if (!PDFLib) return 0;
    let doc;
    try {
      doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch {
      return 0;   // encrypted or damaged: form filling is unavailable
    }
    this.doc = doc;
    let form;
    try { form = doc.getForm(); } catch { return 0; }
    let raw = [];
    try { raw = form.getFields(); } catch { return 0; }
    if (!raw.length) return 0;

    const pageIndex = new Map();
    doc.getPages().forEach((page, i) => pageIndex.set(page.ref.toString(), i + 1));

    this.fields = [];
    this.byPage.clear();
    for (const field of raw) {
      try {
        const kind = kindOf(field);
        if (kind === 'unknown') continue;
        const widgets = field.acroField.getWidgets?.() || [];
        if (!widgets.length) continue;
        const options = this.optionsFor(field, kind);
        widgets.forEach((widget, wi) => {
          const ref = widget.P?.();
          const page = ref ? pageIndex.get(ref.toString()) : null;
          const rect = widget.getRectangle?.();
          if (!page || !rect || !rect.width || !rect.height) return;
          const entry = {
            id: `${field.getName()}#${wi}`,
            name: field.getName(),
            kind,
            page,
            rect,
            options,
            exportValue: widget.getOnValue?.() ? String(widget.getOnValue()) : null,
            readOnly: field.isReadOnly?.() || false
          };
          this.fields.push(entry);
          if (!this.byPage.has(page)) this.byPage.set(page, []);
          this.byPage.get(page).push(entry);
          if (!this.values.has(entry.id)) this.values.set(entry.id, this.initialValue(field, kind));
        });
      } catch { /* skip malformed field */ }
    }
    return this.fields.length;
  }

  optionsFor(field, kind) {
    try {
      if (kind === 'choice' || kind === 'radio') return field.getOptions() || [];
    } catch { /* ignore */ }
    return [];
  }

  initialValue(field, kind) {
    try {
      if (kind === 'checkbox') return !!field.isChecked();
      if (kind === 'radio') return field.getSelected?.() || '';
      if (kind === 'choice') return field.getSelected?.()?.[0] || '';
      if (kind === 'text') return field.getText?.() || '';
    } catch { /* ignore */ }
    return '';
  }

  setVisible(on) {
    this.visible = !!on;
    this.viewer.pages.forEach((pv) => this.renderPage(pv.num));
    this.onChange(this);
  }

  syncZoom() {
    this.viewer.pages.forEach((pv) => {
      const layer = this.layers.get(pv.num);
      if (layer) this.styleLayer(layer, pv);
    });
  }

  styleLayer(layer, pv) {
    const s = this.viewer.scale;
    layer.style.width = `${pv.baseSize.width}px`;
    layer.style.height = `${pv.baseSize.height}px`;
    layer.style.transform = `scale(${s})`;
    layer.style.transformOrigin = '0 0';
    layer.style.setProperty('--form-scale', String(s));
  }

  renderPage(num) {
    const pv = this.viewer.pages[num - 1];
    if (!pv || !pv.wrap) return;
    const existing = this.layers.get(num);
    if (existing) { existing.remove(); this.layers.delete(num); }
    const fields = this.byPage.get(num);
    if (!this.visible || !fields || !fields.length) return;

    const layer = document.createElement('div');
    layer.className = 'form-layer';
    layer.dataset.page = String(num);
    const pageHeight = pv.baseSize.height;
    const scale = this.viewer.scale;

    for (const field of fields) {
      if (field.kind === 'signature') continue;   // signed with the signature tool
      const r = field.rect;
      const el = document.createElement('label');
      el.className = 'form-field';
      el.style.left = `${r.x}px`;
      el.style.top = `${pageHeight - r.y - r.height}px`;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      el.style.fontSize = `${Math.max(6, Math.min(11, r.height * 0.62))}px`;
      el.title = field.name;

      const input = this.buildInput(field);
      if (!input) continue;
      el.append(input);
      layer.append(el);
    }
    this.styleLayer(layer, pv);
    pv.wrap.append(layer);
    this.layers.set(num, layer);
    void scale;
  }

  buildInput(field) {
    const value = this.values.get(field.id);
    let input;
    if (field.kind === 'text') {
      input = document.createElement('input');
      input.type = 'text';
      input.value = typeof value === 'string' ? value : '';
      input.addEventListener('input', () => this.setValue(field, input.value));
    } else if (field.kind === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value === true;
      input.addEventListener('change', () => this.setValue(field, input.checked));
    } else if (field.kind === 'radio') {
      input = document.createElement('input');
      input.type = 'radio';
      input.checked = value === (field.exportValue || '');
      input.name = 'radio-' + field.name;
      input.addEventListener('change', () => this.setValue(field, field.exportValue || ''));
    } else if (field.kind === 'choice') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '—';
      input.append(blank);
      (field.options || []).forEach((opt) => {
        const o = document.createElement('option');
        o.value = String(opt);
        o.textContent = String(opt);
        input.append(o);
      });
      input.value = typeof value === 'string' ? value : '';
      input.addEventListener('change', () => this.setValue(field, input.value));
    } else {
      return null;
    }
    input.disabled = field.readOnly;
    input.className = 'form-input form-input-' + field.kind;
    input.setAttribute('aria-label', field.name);
    return input;
  }

  setValue(field, value) {
    this.values.set(field.id, value);
    this.dirty = true;
    this.onChange(this);
  }

  /** Write the values into the PDF. */
  async save({ flatten = true } = {}) {
    if (!this.doc) throw new Error('No form was loaded.');
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const doc = this.doc;
    const form = doc.getForm();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let applied = 0;

    for (const field of this.fields) {
      const value = this.values.get(field.id);
      let target;
      try { target = form.getField(field.name); } catch { continue; }
      if (!target) continue;
      try {
        if (field.kind === 'text') {
          target.setText(typeof value === 'string' ? value : '');
        } else if (field.kind === 'checkbox') {
          // Only the first widget of a checkbox may toggle it.
          if (field.id.endsWith('#0')) value ? target.check() : target.uncheck();
        } else if (field.kind === 'radio') {
          if (value) target.select(String(value));
        } else if (field.kind === 'choice') {
          if (value) target.select(String(value));
        } else {
          continue;
        }
        applied++;
      } catch { /* field could not be set; leave it */ }
    }

    try { form.updateFieldAppearances(font); } catch { /* older pdf-lib */ }
    if (flatten) {
      try { form.flatten(); } catch (e) { console.warn('Flatten failed', e?.message); }
    }
    const bytes = await doc.save();
    return { bytes: new Uint8Array(bytes), applied, fields: this.fields.length };
  }

  destroy() {
    this.layers.forEach((layer) => layer.remove());
    this.layers.clear();
    this.fields = [];
    this.byPage.clear();
    this.values.clear();
    this.doc = null;
    this.bytes = null;
  }

  /** Count fields per page for the sidebar summary. */
  summary() {
    return { fields: this.fields.length, filled: this.filledCount, pages: this.byPage.size };
  }

  notifyMissing() {
    if (!this.hasFields) toast('This PDF has no fillable form fields.', { type: 'info', duration: 2600 });
  }
}
