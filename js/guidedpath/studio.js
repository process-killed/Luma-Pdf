/**
 * GuidedPath creation workspace: a floating recorder, a timeline editor and a step
 * inspector, layered over the existing viewer so the PDF behaves exactly as it does
 * everywhere else.
 */
import { icon } from '../ui/icons.js';
import { toast, confirmDialog, promptDialog } from '../ui/ui.js';
import { createStep, STEP_TYPES, normalizeRegion, normalizeSpotlight, QUIZ_KINDS, renderRichText } from './model.js';
import { toNormalized, mergeRegions } from './coords.js';
import { NarrationRecorder, audioDuration, narrationSupported } from './narration.js';

const RECORD_DEBOUNCE = { page: 550, zoom: 900, scroll: 1400 };

export class GuidedPathStudio {
  constructor({ viewer, tour, onSave, onExit, putAsset, getAsset, previewTour }) {
    this.viewer = viewer;
    this.tour = tour;
    this.onSave = onSave;
    this.onExit = onExit;
    this.putAsset = putAsset;
    this.getAsset = getAsset;
    this.previewTour = previewTour;

    this.recording = false;
    this.paused = false;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.pending = {};
    this.recorder = new NarrationRecorder();
    this.dirty = false;
    this.narrationTarget = null;
  }

  /* ---------------- mount ---------------- */
  mount() {
    const bar = document.createElement('div');
    bar.className = 'gp-rec';
    bar.innerHTML = `
      <div class="gp-rec-left">
        <span class="gp-rec-dot" data-ref="dot" aria-hidden="true"></span>
        <span class="gp-rec-label" data-ref="label">Ready to record</span>
        <span class="gp-rec-count" data-ref="count">${this.tour.steps.length} steps</span>
      </div>
      <div class="gp-rec-actions">
        <button class="gp-tb" data-act="record" title="Start recording">${icon('circle')}<span>Record</span></button>
        <button class="gp-tb" data-act="pause" title="Pause recording" hidden>${icon('minus')}<span>Pause</span></button>
        <button class="gp-tb" data-act="stop" title="Stop recording" hidden>${icon('square')}<span>Stop</span></button>
        <span class="gp-tb-sep" aria-hidden="true"></span>
        <button class="gp-tb" data-act="undo" title="Undo last step">${icon('undo')}</button>
        <button class="gp-tb" data-act="redo" title="Redo">${icon('redo')}</button>
        <button class="gp-tb" data-act="add" title="Add a step manually">${icon('plus')}<span>Add step</span></button>
        <button class="gp-tb" data-act="preview" title="Preview the tour">${icon('play')}<span>Preview</span></button>
        <button class="gp-tb gp-tb-primary" data-act="save" title="Save the tour">${icon('save')}<span>Save</span></button>
        <button class="gp-tb" data-act="close" title="Close the studio">${icon('x')}</button>
      </div>`;
    document.body.append(bar);

    const panel = document.createElement('aside');
    panel.className = 'gp-timeline';
    panel.setAttribute('aria-label', 'Tour timeline');
    panel.innerHTML = `
      <header class="gp-timeline-head">
        <div>
          <span class="gp-kicker">Timeline</span>
          <strong data-ref="tourTitle">${escapeHtml(this.tour.title)}</strong>
        </div>
        <button class="gp-icon-btn" data-act="collapse" title="Hide the timeline" aria-label="Hide the timeline">${icon('chevron-down')}</button>
      </header>
      <div class="gp-timeline-list" data-ref="list" role="list"></div>
      <footer class="gp-timeline-foot">
        <button class="btn btn-ghost btn-sm" data-act="add">${icon('plus', 'icon-sm')} Add step</button>
        <span class="muted small" data-ref="meta"></span>
      </footer>`;
    document.body.append(panel);

    const drawer = document.createElement('div');
    drawer.className = 'gp-inspector';
    drawer.hidden = true;
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Step settings');
    document.body.append(drawer);

    this.bar = bar;
    this.panel = panel;
    this.drawer = drawer;
    this.els = {
      dot: bar.querySelector('[data-ref="dot"]'),
      label: bar.querySelector('[data-ref="label"]'),
      count: bar.querySelector('[data-ref="count"]'),
      list: panel.querySelector('[data-ref="list"]'),
      meta: panel.querySelector('[data-ref="meta"]'),
      tourTitle: panel.querySelector('[data-ref="tourTitle"]')
    };
    // On a phone the timeline would cover the page: start it collapsed.
    if (window.innerWidth < 861) panel.classList.add('is-collapsed');
    document.body.classList.add('gp-studio');

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      this.onBarAction(btn.dataset.act, btn);
    });
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn?.dataset.act === 'collapse') { panel.classList.toggle('is-collapsed'); return; }
      const card = e.target.closest('.gp-step');
      if (!card) return;
      const act = e.target.closest('[data-step-act]')?.dataset.stepAct;
      const id = card.dataset.id;
      if (act === 'delete') this.removeStep(id);
      else if (act === 'duplicate') this.duplicateStep(id);
      else if (act === 'up') this.moveStep(id, -1);
      else if (act === 'down') this.moveStep(id, 1);
      else if (act === 'preview') this.previewStep(id);
      else this.select(id);
    });
    this.wireDrag(panel.querySelector('[data-ref="list"]'));
    this.render();
  }

  onBarAction(act, btn) {
    if (act === 'add') { this.openAddMenu(btn); return; }
    if (act === 'record') this.startRecording();
    else if (act === 'pause') this.pauseRecording();
    else if (act === 'stop') this.stopRecording();
    else if (act === 'undo') this.undo();
    else if (act === 'redo') this.redo();
    else if (act === 'preview') this.previewTour?.(this.tour);
    else if (act === 'save') this.save();
    else if (act === 'close') this.close();
  }

  /* ---------------- recording ---------------- */
  startRecording() {
    this.recording = true;
    this.paused = false;
    this.syncBar();
    toast('Recording — move through the document and your steps are captured.', { duration: 2600 });
  }

  pauseRecording() {
    if (!this.recording) return;
    this.paused = true;
    this.syncBar();
  }

  stopRecording() {
    this.recording = false;
    this.paused = false;
    this.flushPending();
    this.syncBar();
  }

  syncBar() {
    const on = this.recording && !this.paused;
    this.els.dot.dataset.state = this.paused ? 'paused' : on ? 'on' : 'off';
    this.els.label.textContent = this.paused ? 'Paused' : on ? 'Recording' : 'Ready to record';
    this.bar.querySelector('[data-act="record"]').hidden = this.recording;
    this.bar.querySelector('[data-act="pause"]').hidden = !on;
    this.bar.querySelector('[data-act="stop"]').hidden = !this.recording;
    this.els.count.textContent = `${this.tour.steps.length} step${this.tour.steps.length === 1 ? '' : 's'}`;
  }

  /** Called by the viewer for every meaningful event. */
  onViewerEvent(type, detail = {}) {
    if (!this.recording || this.paused) return;
    if (type === 'pageChanged') this.schedule('page', detail.page, RECORD_DEBOUNCE.page);
    else if (type === 'zoomSettled') this.schedule('zoom', detail.scale, RECORD_DEBOUNCE.zoom);
    else if (type === 'annotationAdded') this.addSpotlightFromAnnotation(detail);
  }

  schedule(kind, value, delay) {
    clearTimeout(this.pending[kind]);
    this.pending[kind] = setTimeout(() => {
      delete this.pending[kind];
      this.commitRecorded(kind, value);
    }, delay);
  }

  flushPending() {
    for (const [kind, timer] of Object.entries(this.pending)) {
      clearTimeout(timer);
      delete this.pending[kind];
    }
  }

  commitRecorded(kind, value) {
    const page = this.viewer.current;
    if (kind === 'page') {
      const last = this.tour.steps[this.tour.steps.length - 1];
      if (last && last.type === 'page' && last.page === value) return;
      this.pushStep(createStep('page', { page: value, title: `Go to page ${value}`, duration: 2200 }));
    } else if (kind === 'zoom') {
      const scale = Number(value) || this.viewer.scale;
      if (scale < 1.15) return; // ordinary fit-width is not a "smart zoom"
      const last = this.tour.steps[this.tour.steps.length - 1];
      if (last?.type === 'zoom' && last.page === page && Math.abs((last.zoom?.scale || 1) - scale) < 0.15) return;
      this.pushStep(createStep('zoom', {
        page,
        title: `Zoom to ${Math.round(scale * 100)}%`,
        duration: 3000,
        zoom: { scale, x: 0.5, y: 0.5, transition: 650 }
      }));
    }
  }

  addSpotlightFromAnnotation(detail) {
    const pv = this.viewer.pages?.[detail.page - 1];
    if (!pv?.annotEl || !detail.rect) return;
    const rect = pv.annotEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const region = normalizeRegion({
      x: (detail.rect.x - rect.left) / rect.width,
      y: (detail.rect.y - rect.top) / rect.height,
      w: detail.rect.w / rect.width,
      h: detail.rect.h / rect.height
    });
    this.pushStep(createStep('spotlight', {
      page: detail.page,
      title: 'Spotlight',
      duration: 3200,
      spotlight: normalizeSpotlight({ regions: mergeRegions([region]) })
    }));
  }

  /* ---------------- step editing ---------------- */
  pushStep(step) {
    this.undoStack.push(this.snapshot());
    this.redoStack.length = 0;
    this.tour.steps.push(step);
    this.dirty = true;
    this.selectedId = step.id;
    this.render();
    this.openInspector(step);
  }

  /** Small menu so every step type is reachable. */
  openAddMenu(anchor) {
    document.querySelector('.gp-add-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'menu gp-add-menu';
    menu.dataset.open = 'true';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = Object.entries(STEP_TYPES).map(([type, meta]) =>
      `<button class="menu-item" role="menuitem" data-type="${type}">${icon(meta.icon)}<span>${meta.label}</span></button>`).join('');
    document.body.append(menu);
    const rect = (anchor || this.bar).getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 260, Math.max(8, rect.left))}px`;
    menu.style.top = `${Math.max(8, rect.top - 12)}px`;
    menu.style.transform = 'translateY(-100%)';
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-type]');
      if (item) this.addManualStep(item.dataset.type);
      menu.remove();
    });
    setTimeout(() => {
      const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', off); } };
      document.addEventListener('click', off);
    }, 0);
  }

  addManualStep(type = 'text') {
    const step = createStep(type, {
      page: this.viewer.current,
      title: STEP_TYPES[type].label,
      duration: 3000,
      ...(type === 'zoom' ? { zoom: { scale: Math.max(1.4, this.viewer.scale || 1.4), x: 0.5, y: 0.5, transition: 650 } } : {}),
      ...(type === 'spotlight' ? { spotlight: normalizeSpotlight({}) } : {}),
      ...(type === 'quiz' ? { quiz: { kind: 'choice', question: 'What did you just read?', options: ['', '', ''], answer: 0, explanation: '' } } : {}),
      ...(type === 'checkpoint' ? { checkpoint: { message: 'Have you finished this section?', label: 'Continue' } } : {}),
      ...(type === 'link' ? { link: { url: '', label: '' } } : {})
    });
    this.pushStep(step);
  }

  removeStep(id) {
    const index = this.tour.steps.findIndex((s) => s.id === id);
    if (index === -1) return;
    this.undoStack.push(this.snapshot());
    this.redoStack.length = 0;
    this.tour.steps.splice(index, 1);
    this.dirty = true;
    if (this.selectedId === id) { this.selectedId = null; this.drawer.hidden = true; }
    this.render();
  }

  duplicateStep(id) {
    const index = this.tour.steps.findIndex((s) => s.id === id);
    if (index === -1) return;
    this.undoStack.push(this.snapshot());
    this.redoStack.length = 0;
    const copy = JSON.parse(JSON.stringify(this.tour.steps[index]));
    copy.id = createStep(copy.type).id;
    copy.title = `${copy.title || STEP_TYPES[copy.type].label} copy`;
    this.tour.steps.splice(index + 1, 0, copy);
    this.dirty = true;
    this.render();
  }

  moveStep(id, delta) {
    const index = this.tour.steps.findIndex((s) => s.id === id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= this.tour.steps.length) return;
    this.undoStack.push(this.snapshot());
    this.redoStack.length = 0;
    const [step] = this.tour.steps.splice(index, 1);
    this.tour.steps.splice(target, 0, step);
    this.dirty = true;
    this.render();
  }

  reorder(fromId, toId) {
    const from = this.tour.steps.findIndex((s) => s.id === fromId);
    const to = this.tour.steps.findIndex((s) => s.id === toId);
    if (from === -1 || to === -1 || from === to) return;
    this.undoStack.push(this.snapshot());
    this.redoStack.length = 0;
    const [step] = this.tour.steps.splice(from, 1);
    this.tour.steps.splice(to, 0, step);
    this.dirty = true;
    this.render();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.tour.steps = this.undoStack.pop();
    this.dirty = true;
    this.render();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.tour.steps = this.redoStack.pop();
    this.dirty = true;
    this.render();
  }

  snapshot() { return JSON.parse(JSON.stringify(this.tour.steps)); }

  previewStep(id) {
    const step = this.tour.steps.find((s) => s.id === id);
    if (!step) return;
    this.previewTour?.({ ...this.tour, steps: [step] }, { single: true });
  }

  /* ---------------- render ---------------- */
  render() {
    const list = this.els.list;
    list.replaceChildren();
    if (!this.tour.steps.length) {
      const empty = document.createElement('div');
      empty.className = 'gp-empty';
      empty.innerHTML = `<p><strong>No steps yet.</strong></p><p class="small muted">Press Record and move through the document — page changes, zooms and highlights become steps. Or add a step manually.</p>`;
      list.append(empty);
    }
    this.tour.steps.forEach((step, index) => {
      const card = document.createElement('div');
      card.className = 'gp-step';
      card.dataset.id = step.id;
      card.dataset.type = step.type;
      card.draggable = true;
      card.tabIndex = 0;
      card.setAttribute('role', 'listitem');
      if (step.id === this.selectedId) card.dataset.selected = 'true';
      const meta = STEP_TYPES[step.type];
      card.innerHTML = `
        <span class="gp-step-index">${index + 1}</span>
        <span class="gp-step-icon">${icon(meta.icon, 'icon-sm')}</span>
        <span class="gp-step-body">
          <span class="gp-step-title">${escapeHtml(step.title || meta.label)}</span>
          <span class="gp-step-meta">${escapeHtml(meta.label)} · page ${step.page} · ${(step.duration / 1000).toFixed(1)}s${step.narration?.assetId ? ' · voice' : ''}${step.type === 'quiz' ? ' · quiz' : ''}</span>
        </span>
        <span class="gp-step-actions">
          <button class="gp-icon-btn" data-step-act="up" title="Move up" aria-label="Move step up">${icon('chevron-up', 'icon-sm')}</button>
          <button class="gp-icon-btn" data-step-act="down" title="Move down" aria-label="Move step down">${icon('chevron-down', 'icon-sm')}</button>
          <button class="gp-icon-btn" data-step-act="preview" title="Preview this step" aria-label="Preview step">${icon('play', 'icon-sm')}</button>
          <button class="gp-icon-btn" data-step-act="duplicate" title="Duplicate" aria-label="Duplicate step">${icon('copy', 'icon-sm')}</button>
          <button class="gp-icon-btn" data-step-act="delete" title="Delete" aria-label="Delete step">${icon('trash', 'icon-sm')}</button>
        </span>`;
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.select(step.id); });
      list.append(card);
    });
    const total = this.tour.steps.reduce((sum, s) => sum + (s.duration || 0), 0);
    this.els.meta.textContent = `${this.tour.steps.length} steps · ${Math.round(total / 1000)}s`;
    this.els.count.textContent = `${this.tour.steps.length} step${this.tour.steps.length === 1 ? '' : 's'}`;
  }

  wireDrag(list) {
    let draggingId = null;
    list.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.gp-step');
      if (!card) return;
      draggingId = card.dataset.id;
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', draggingId); } catch { /* ignore */ }
    });
    list.addEventListener('dragend', () => {
      list.querySelectorAll('.gp-step').forEach((c) => c.classList.remove('is-dragging', 'is-over'));
      draggingId = null;
    });
    list.addEventListener('dragover', (e) => {
      const card = e.target.closest('.gp-step');
      if (!card || !draggingId) return;
      e.preventDefault();
      list.querySelectorAll('.gp-step').forEach((c) => c.classList.toggle('is-over', c === card));
    });
    list.addEventListener('drop', (e) => {
      const card = e.target.closest('.gp-step');
      if (!card || !draggingId) return;
      e.preventDefault();
      this.reorder(draggingId, card.dataset.id);
      draggingId = null;
    });
  }

  select(id) {
    this.selectedId = id;
    const step = this.tour.steps.find((s) => s.id === id);
    this.render();
    if (step) this.openInspector(step);
  }

  /* ---------------- inspector ---------------- */
  openInspector(step) {
    const drawer = this.drawer;
    drawer.hidden = false;
    drawer.dataset.type = step.type;
    const typeLabel = STEP_TYPES[step.type].label;
    drawer.innerHTML = `
      <header class="gp-inspector-head">
        <div>
          <span class="gp-kicker">${escapeHtml(typeLabel)}</span>
          <strong>Step ${this.tour.steps.indexOf(step) + 1}</strong>
        </div>
        <button class="gp-icon-btn" data-act="close" aria-label="Close settings">${icon('x')}</button>
      </header>
      <div class="gp-inspector-body">
        <label class="field"><span class="label">Title</span>
          <input class="input" data-f="title" value="${escapeAttr(step.title)}" maxlength="120"></label>
        <label class="field"><span class="label">Page</span>
          <input class="input" type="number" min="1" max="${this.tour.pageCount || 9999}" data-f="page" value="${step.page}"></label>
        <label class="field"><span class="label">Auto-advance after (seconds)</span>
          <input class="input" type="number" min="0.5" max="120" step="0.5" data-f="duration" value="${(step.duration / 1000).toFixed(1)}"></label>
        <label class="field"><span class="label">Explanation (supports **bold**, *italic*, - lists, # headings, [links](https://…))</span>
          <textarea class="input" rows="5" data-f="text" maxlength="8000">${escapeHtml(step.text)}</textarea></label>
        ${this.typeFields(step)}
      </div>
      <footer class="gp-inspector-foot">
        <button class="btn btn-primary btn-sm" data-act="apply">Done</button>
        <button class="btn btn-ghost btn-sm" data-act="delete">Delete step</button>
      </footer>`;

    drawer.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close' || act === 'apply') { this.applyInspector(step); drawer.hidden = true; }
      else if (act === 'delete') { this.removeStep(step.id); drawer.hidden = true; }
      else if (act?.startsWith('pick-')) this.pickRegion(step, act);
      else if (act === 'record-narration') this.recordNarration(step);
      else if (act === 'stop-narration') this.stopNarration(step);
      else if (act === 'delete-narration') this.deleteNarration(step);
      else if (act === 'play-narration') this.playNarration(step);
      else if (act === 'add-option') this.addQuizOption(step);
    }, { once: false });
  }

  typeFields(step) {
    if (step.type === 'zoom' || step.type === 'focus') {
      const z = step.zoom || { scale: 1.6, x: 0.5, y: 0.5, transition: 650 };
      return `
        <fieldset class="gp-fieldset"><legend>Camera</legend>
          <label class="field"><span class="label">Zoom (1 = 100%)</span>
            <input class="input" type="number" min="0.5" max="8" step="0.1" data-f="zoomScale" value="${z.scale}"></label>
          <label class="field"><span class="label">Centre — horizontal</span>
            <input class="input" type="range" min="0" max="1" step="0.01" data-f="zoomX" value="${z.x}"></label>
          <label class="field"><span class="label">Centre — vertical</span>
            <input class="input" type="range" min="0" max="1" step="0.01" data-f="zoomY" value="${z.y}"></label>
          <button class="btn btn-ghost btn-sm" data-act="pick-zoom">Use what I am looking at now</button>
        </fieldset>`;
    }
    if (step.type === 'spotlight') {
      const s = step.spotlight || normalizeSpotlight({});
      return `
        <fieldset class="gp-fieldset"><legend>Spotlight</legend>
          <p class="small muted">${s.regions.length} region${s.regions.length === 1 ? '' : 's'}</p>
          <button class="btn btn-ghost btn-sm" data-act="pick-spotlight">Draw a new region on the page</button>
          <label class="field"><span class="label">Dimming</span>
            <input class="input" type="range" min="0" max="0.95" step="0.05" data-f="spotOpacity" value="${s.opacity}"></label>
          <label class="field"><span class="label">Border width</span>
            <input class="input" type="number" min="0" max="8" step="1" data-f="spotBorder" value="${s.border}"></label>
        </fieldset>`;
    }
    if (step.type === 'narration' || step.narration) {
      const n = step.narration;
      return `
        <fieldset class="gp-fieldset"><legend>Voice narration</legend>
          ${n?.assetId
    ? `<p class="small">Recorded · ${(n.duration || 0).toFixed(1)}s
        <button class="btn btn-ghost btn-sm" data-act="play-narration">Play</button>
        <button class="btn btn-ghost btn-sm" data-act="record-narration">Replace</button>
        <button class="btn btn-ghost btn-sm" data-act="delete-narration">Delete</button></p>`
    : `<p class="small muted">${narrationSupported() ? 'Record your voice for this step.' : 'Recording is not available in this browser.'}</p>
       <button class="btn btn-ghost btn-sm" data-act="record-narration" ${narrationSupported() ? '' : 'disabled'}>Record narration</button>`}
          <div class="gp-rec-live" data-ref="recLive" hidden>
            <span class="gp-rec-dot" data-state="on"></span>
            <span data-ref="recTime">0.0s</span>
            <button class="btn btn-primary btn-sm" data-act="stop-narration">Stop</button>
          </div>
          <label class="field"><span class="label">Volume</span>
            <input class="input" type="range" min="0" max="1" step="0.05" data-f="narrVolume" value="${n?.volume ?? 1}"></label>
        </fieldset>`;
    }
    if (step.type === 'quiz') {
      const q = step.quiz || { kind: 'choice', question: '', options: ['', ''], answer: 0, explanation: '' };
      const options = q.kind === 'short' ? '' : `
        <div class="gp-quiz-opts">
          ${(q.kind === 'boolean' ? ['True', 'False'] : q.options).map((opt, i) => `
            <label class="gp-quiz-opt"><input type="radio" name="quizAnswer" value="${i}" ${Number(q.answer) === i ? 'checked' : ''}>
              <input class="input" data-f="opt${i}" value="${escapeAttr(q.kind === 'boolean' ? opt : opt)}" ${q.kind === 'boolean' ? 'readonly' : ''} placeholder="Option ${i + 1}"></label>`).join('')}
          ${q.kind === 'choice' ? '<button class="btn btn-ghost btn-sm" data-act="add-option">Add option</button>' : ''}
        </div>`;
      return `
        <fieldset class="gp-fieldset"><legend>Quiz</legend>
          <label class="field"><span class="label">Type</span>
            <select class="input" data-f="quizKind">
              ${Object.entries(QUIZ_KINDS).map(([k, label]) => `<option value="${k}" ${q.kind === k ? 'selected' : ''}>${label}</option>`).join('')}
            </select></label>
          <label class="field"><span class="label">Question</span>
            <input class="input" data-f="quizQuestion" value="${escapeAttr(q.question)}" maxlength="300"></label>
          ${options}
          ${q.kind === 'short' ? `<label class="field"><span class="label">Correct answer</span>
            <input class="input" data-f="quizShort" value="${escapeAttr(q.answer)}"></label>` : ''}
          <label class="field"><span class="label">Explanation shown after answering</span>
            <textarea class="input" rows="2" data-f="quizExplanation">${escapeHtml(q.explanation)}</textarea></label>
        </fieldset>`;
    }
    if (step.type === 'checkpoint') {
      const c = step.checkpoint || {};
      return `
        <fieldset class="gp-fieldset"><legend>Checkpoint</legend>
          <label class="field"><span class="label">Message</span>
            <input class="input" data-f="checkMessage" value="${escapeAttr(c.message || '')}" maxlength="300"></label>
          <label class="field"><span class="label">Button label</span>
            <input class="input" data-f="checkLabel" value="${escapeAttr(c.label || 'Continue')}" maxlength="60"></label>
        </fieldset>`;
    }
    if (step.type === 'link') {
      const l = step.link || {};
      return `
        <fieldset class="gp-fieldset"><legend>External resource</legend>
          <label class="field"><span class="label">URL (https:// only)</span>
            <input class="input" type="url" data-f="linkUrl" value="${escapeAttr(l.url || '')}" placeholder="https://example.com"></label>
          <label class="field"><span class="label">Label</span>
            <input class="input" data-f="linkLabel" value="${escapeAttr(l.label || '')}" maxlength="120"></label>
          <p class="small muted">Links open in a new tab and are never loaded automatically.</p>
        </fieldset>`;
    }
    return '';
  }

  applyInspector(step) {
    const get = (f) => this.drawer.querySelector(`[data-f="${f}"]`);
    const value = (f) => get(f)?.value;
    step.title = value('title') ?? step.title;
    const page = Number(value('page'));
    if (Number.isFinite(page) && page >= 1) step.page = Math.min(this.tour.pageCount || page, Math.round(page));
    const duration = Number(value('duration'));
    if (Number.isFinite(duration)) step.duration = Math.max(500, Math.min(120000, duration * 1000));
    step.text = value('text') ?? step.text;

    if (step.type === 'zoom' || step.type === 'focus') {
      step.zoom = {
        scale: Number(value('zoomScale')) || 1.6,
        x: Number(value('zoomX')) || 0.5,
        y: Number(value('zoomY')) || 0.5,
        transition: 650
      };
    }
    if (step.type === 'spotlight') {
      step.spotlight = normalizeSpotlight({
        ...(step.spotlight || {}),
        opacity: Number(value('spotOpacity')),
        border: Number(value('spotBorder'))
      });
    }
    if (step.narration && value('narrVolume') !== undefined) {
      step.narration.volume = Number(value('narrVolume'));
    }
    if (step.type === 'quiz') {
      const kind = value('quizKind') || 'choice';
      const options = kind === 'short' ? [] : kind === 'boolean' ? ['True', 'False']
        : (step.quiz?.options || []).map((_, i) => value(`opt${i}`) ?? '');
      const checked = this.drawer.querySelector('input[name="quizAnswer"]:checked');
      step.quiz = {
        kind,
        question: value('quizQuestion') || '',
        options,
        answer: kind === 'short' ? (value('quizShort') || '') : Number(checked?.value ?? 0),
        explanation: value('quizExplanation') || ''
      };
    }
    if (step.type === 'checkpoint') {
      step.checkpoint = { message: value('checkMessage') || '', label: value('checkLabel') || 'Continue' };
    }
    if (step.type === 'link') {
      step.link = { url: value('linkUrl') || '', label: value('linkLabel') || '' };
    }
    this.dirty = true;
    this.render();
    toast('Step updated', { duration: 1200 });
  }

  addQuizOption(step) {
    step.quiz = step.quiz || { kind: 'choice', options: [], answer: 0 };
    step.quiz.options = [...(step.quiz.options || []), ''];
    this.openInspector(step);
  }

  /* ---------------- region picking ---------------- */
  pickRegion(step, act) {
    const pv = this.viewer.pages?.[step.page - 1];
    if (!pv?.annotEl) { toast('Open that page first.', { type: 'warn' }); return; }
    const el = pv.annotEl;
    const rect = el.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.className = 'gp-pick';
    overlay.innerHTML = '<div class="gp-pick-box"></div><p class="gp-pick-hint">Drag on the page to mark a region</p>';
    document.body.append(overlay);
    const box = overlay.querySelector('.gp-pick-box');
    let start = null;
    const onDown = (e) => {
      start = { x: e.clientX, y: e.clientY };
      box.style.display = 'block';
    };
    const onMove = (e) => {
      if (!start) return;
      const x = Math.min(start.x, e.clientX);
      const y = Math.min(start.y, e.clientY);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${Math.abs(e.clientX - start.x)}px`;
      box.style.height = `${Math.abs(e.clientY - start.y)}px`;
    };
    const onUp = (e) => {
      if (!start) return;
      const region = normalizeRegion({
        x: (Math.min(start.x, e.clientX) - rect.left) / rect.width,
        y: (Math.min(start.y, e.clientY) - rect.top) / rect.height,
        w: Math.abs(e.clientX - start.x) / rect.width,
        h: Math.abs(e.clientY - start.y) / rect.height
      });
      cleanup();
      if (region.w < 0.01 || region.h < 0.005) { toast('That region is too small — try again.', { type: 'warn' }); return; }
      if (act === 'pick-zoom') {
        step.zoom = { scale: step.zoom?.scale || 1.8, x: region.x + region.w / 2, y: region.y + region.h / 2, transition: 650 };
      } else {
        step.spotlight = normalizeSpotlight({ ...(step.spotlight || {}), regions: mergeRegions([region]) });
      }
      this.dirty = true;
      this.openInspector(step);
      this.render();
    };
    const cleanup = () => {
      overlay.remove();
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  }

  /* ---------------- narration ---------------- */
  async recordNarration(step) {
    const live = this.drawer.querySelector('[data-ref="recLive"]');
    const time = this.drawer.querySelector('[data-ref="recTime"]');
    try {
      await this.recorder.start();
    } catch (err) {
      toast(err.message, { type: 'error', duration: 5000 });
      return;
    }
    if (live) live.hidden = false;
    const started = performance.now();
    const tick = setInterval(() => {
      if (time) time.textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
    }, 100);
    this._narrTick = tick;
    this.narrationTarget = step;
  }

  async stopNarration(step) {
    clearInterval(this._narrTick);
    const result = await this.recorder.stop();
    if (!result) return;
    const duration = await audioDuration(result.blob);
    const asset = await this.putAsset({ tourId: this.tour.id, kind: 'narration', blob: result.blob, mime: result.mime, duration });
    if (step.narration?.assetId && step.narration.assetId !== asset.id) {
      // leave the old asset; pruneAssets() removes orphans on save
    }
    step.narration = { assetId: asset.id, mime: asset.mime, duration, volume: step.narration?.volume ?? 1 };
    this.dirty = true;
    this.openInspector(step);
    this.render();
    toast(`Narration saved (${duration.toFixed(1)}s)`, { duration: 2000 });
  }

  deleteNarration(step) {
    step.narration = null;
    this.dirty = true;
    this.openInspector(step);
    this.render();
  }

  async playNarration(step) {
    const asset = await this.getAsset(step.narration?.assetId);
    if (!asset?.blob) { toast('That narration is missing.', { type: 'warn' }); return; }
    const audio = new Audio(URL.createObjectURL(asset.blob));
    audio.play().catch(() => toast('Could not play the narration.', { type: 'error' }));
    audio.onended = () => URL.revokeObjectURL(audio.src);
  }

  /* ---------------- save / close ---------------- */
  async save() {
    this.flushPending();
    this.tour.pageCount = this.tour.pageCount || this.viewer.pages.length;
    await this.onSave?.(this.tour);
    this.dirty = false;
    toast('GuidedPath saved', { duration: 2000 });
  }

  async close() {
    if (this.dirty) {
      const ok = await confirmDialog({
        title: 'Leave the studio?',
        message: 'You have unsaved steps. Leave anyway?',
        confirmLabel: 'Leave without saving'
      });
      if (!ok) return;
    }
    this.recorder.cancel();
    this.bar.remove();
    this.panel.remove();
    this.drawer.remove();
    document.body.classList.remove('gp-studio');
    this.onExit?.();
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
