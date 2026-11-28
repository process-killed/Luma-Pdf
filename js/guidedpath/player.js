/**
 * GuidedPath playback: performs each step in order and drives the cinematic chrome.
 *
 * One timer, one narration element, one cancellation token — stepping never overlaps
 * itself, and leaving the tour cancels everything that was pending.
 */
import { icon } from '../ui/icons.js';
import { renderRichText } from './model.js';
import { SpotlightOverlay } from './spotlight.js';
import { createQuizView } from './quiz.js';
import { NarrationPlayer } from './narration.js';
import { frameForRegion } from './coords.js';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export class GuidedPathPlayer {
  constructor({ viewer, tour, getAsset, onExit, onScore } = {}) {
    this.viewer = viewer;
    this.tour = tour;
    this.steps = tour.steps || [];
    this.getAsset = getAsset;
    this.onExit = onExit;
    this.onScore = onScore;

    this.index = -1;
    this.playing = false;
    this.speed = 1;
    this.timer = null;
    this.token = 0;
    this.score = { correct: 0, asked: 0 };
    this.spotlight = new SpotlightOverlay(document.body);
    this.narration = new NarrationPlayer();
    this.els = {};
    this.mounted = false;
    this.answered = new Set();
  }

  /* ---------------- chrome ---------------- */
  mount() {
    if (this.mounted) return;
    const stage = document.createElement('div');
    stage.className = 'gp-stage';
    stage.innerHTML = `
      <div class="gp-top">
        <div class="gp-title">
          <span class="gp-kicker">GuidedPath</span>
          <strong>${escapeHtml(this.tour.title || 'Untitled tour')}</strong>
        </div>
        <div class="gp-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="gp-progress-bar"></span>
        </div>
        <div class="gp-counter"><span data-ref="step">1</span> / ${this.steps.length}</div>
        <button class="gp-icon-btn" data-act="exit" title="Exit presentation (Esc)" aria-label="Exit presentation">${icon('x')}</button>
      </div>

      <div class="gp-side" data-ref="side" hidden></div>

      <div class="gp-caption" data-ref="caption" hidden></div>

      <div class="gp-bottom" role="toolbar" aria-label="Playback controls">
        <button class="gp-icon-btn" data-act="prev" title="Previous step (←)" aria-label="Previous step">${icon('chevron-left')}</button>
        <button class="gp-play" data-act="play" title="Play or pause (Space)" aria-label="Play">
          <span data-ref="playIcon">${icon('play')}</span>
        </button>
        <button class="gp-icon-btn" data-act="next" title="Next step (→)" aria-label="Next step">${icon('chevron-right')}</button>
        <button class="gp-icon-btn" data-act="restart" title="Restart" aria-label="Restart">${icon('refresh')}</button>
        <div class="gp-sep" aria-hidden="true"></div>
        <button class="gp-chip" data-act="speed" title="Playback speed" aria-label="Playback speed">1×</button>
        <button class="gp-chip" data-act="captions" title="Captions" aria-label="Toggle captions" aria-pressed="false">CC</button>
        <label class="gp-vol">
          <span class="gp-vol-icon" aria-hidden="true">${icon('waves', 'icon-sm')}</span>
          <input type="range" min="0" max="100" value="100" data-act="volume" aria-label="Narration volume">
        </label>
        <div class="gp-sep" aria-hidden="true"></div>
        <button class="gp-icon-btn" data-act="fullscreen" title="Fullscreen (F)" aria-label="Fullscreen">${icon('maximize')}</button>
      </div>

      <div class="gp-toast" data-ref="toast" role="status" hidden></div>
    `;
    document.body.append(stage);
    document.body.classList.add('gp-playing');
    this.stage = stage;
    this.els = {
      step: stage.querySelector('[data-ref="step"]'),
      side: stage.querySelector('[data-ref="side"]'),
      caption: stage.querySelector('[data-ref="caption"]'),
      playIcon: stage.querySelector('[data-ref="playIcon"]'),
      toast: stage.querySelector('[data-ref="toast"]'),
      bar: stage.querySelector('.gp-progress-bar'),
      progress: stage.querySelector('.gp-progress'),
      speed: stage.querySelector('[data-act="speed"]'),
      captions: stage.querySelector('[data-act="captions"]')
    };
    this.captionsOn = false;

    stage.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'prev') this.prev();
      else if (act === 'next') this.next();
      else if (act === 'play') this.toggle();
      else if (act === 'restart') this.restart();
      else if (act === 'exit') this.exit();
      else if (act === 'speed') this.cycleSpeed();
      else if (act === 'captions') this.toggleCaptions();
      else if (act === 'fullscreen') this.toggleFullscreen();
    });
    stage.querySelector('[data-act="volume"]').addEventListener('input', (e) => {
      this.narration.setVolume(Number(e.target.value) / 100);
    });

    this.onKey = (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.prev(); }
      else if (e.key === ' ') { e.preventDefault(); this.toggle(); }
      else if (e.key === 'Escape') { this.exit(); }
      else if (e.key.toLowerCase() === 'f') this.toggleFullscreen();
      else if (e.key.toLowerCase() === 'c') this.toggleCaptions();
    };
    document.addEventListener('keydown', this.onKey);

    // keep the spotlight glued to the page while the reader scrolls or zooms
    this.onScroll = () => {
      const pv = this.viewer?.pages?.[this.index >= 0 ? (this.steps[this.index]?.page || 1) - 1 : 0];
      if (pv?.wrap && this.spotlight.el) this.spotlight.reposition(pv.wrap);
    };
    this.viewer?.workspace?.addEventListener('scroll', this.onScroll, { passive: true });

    this.mounted = true;
  }

  /* ---------------- lifecycle ---------------- */
  async start(index = 0) {
    this.mount();
    this.playing = true;
    this.updatePlayIcon();
    await this.goTo(index, { fromUser: false });
  }

  async goTo(index, { fromUser = false } = {}) {
    if (!this.steps.length) { this.toast('This tour has no steps.'); return; }
    const clamped = Math.max(0, Math.min(this.steps.length - 1, index));
    this.token++;
    const token = this.token;
    this.clearTimer();
    this.narration.stop();
    this.spotlight.hide();
    this.clearSide();

    this.index = clamped;
    const step = this.steps[clamped];
    this.renderChrome();

    try {
      await this.performStep(step, token);
    } catch (err) {
      if (token === this.token) this.toast(`Step ${clamped + 1} could not be shown: ${err.message}`);
    }
    if (token !== this.token) return;
    if (!fromUser) this.scheduleAdvance(step, token);
  }

  scheduleAdvance(step, token) {
    if (!this.playing) return;
    const waitFor = step.type === 'quiz' || step.type === 'checkpoint' ? 0 : Math.max(600, step.duration || 3000);
    if (!waitFor) return;
    this.timer = setTimeout(() => {
      if (token !== this.token) return;
      if (this.index >= this.steps.length - 1) { this.finish(); return; }
      this.goTo(this.index + 1);
    }, waitFor / this.speed);
  }

  async performStep(step, token) {
    const viewer = this.viewer;
    if (!viewer) return;

    // 1. page
    if (step.page && step.page !== viewer.current) {
      await viewer.goToPage(step.page, { smooth: false });
      await this.waitForPage(step.page, token);
    }
    if (token !== this.token) return;

    const pv = viewer.pages?.[step.page - 1];
    if (!pv?.wrap) {
      this.toast(`Page ${step.page} is not available in this document.`);
      return;
    }

    // 2. camera: zoom + scroll to the interesting region
    const target = step.zoom
      || (step.spotlight?.regions?.[0] ? { ...step.spotlight.regions[0], scale: 0 } : null);
    if (target) {
      await this.applyCamera(step, pv, target, token);
      if (token !== this.token) return;
    } else {
      await this.centerPage(pv, token);
    }

    // 3. spotlight
    if (step.spotlight) {
      this.spotlight.show(pv.wrap, step.spotlight);
      this.spotlight.reposition(pv.wrap);
    }

    // 4. side panel (explanation / quiz / checkpoint / link)
    this.renderStepContent(step);

    // 5. narration
    if (step.narration?.assetId && this.getAsset) {
      const asset = await this.getAsset(step.narration.assetId);
      if (token !== this.token) return;
      if (asset?.blob) {
        this.narration.setVolume(step.narration.volume ?? 1);
        this.narration.play(asset.blob, { volume: step.narration.volume ?? 1, rate: this.speed });
      } else {
        this.toast('Narration for this step is missing.');
      }
    }
  }

  async applyCamera(step, pv, target, token) {
    const viewer = this.viewer;
    const scale = target.scale > 0 ? target.scale : null;
    if (scale && Math.abs((viewer.scale || 1) - scale) > 0.01) {
      await viewer.setZoom(Math.round(scale * 100));
      if (token !== this.token) return;
    }
    const region = { x: target.x ?? 0.5, y: target.y ?? 0.5, w: target.w ?? 0.4, h: target.h ?? 0.3 };
    const frame = frameForRegion(pv, region, { padding: 0.16 });
    if (!frame) return;
    const ws = viewer.workspace;
    const behaviour = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    ws.scrollTo({ left: frame.scrollLeft, top: frame.scrollTop, behavior: behaviour });
    await new Promise((r) => setTimeout(r, behaviour === 'smooth' ? 420 : 60));
  }

  async centerPage(pv, token) {
    const ws = this.viewer.workspace;
    if (!ws) return;
    const wsRect = ws.getBoundingClientRect();
    const rect = pv.wrap.getBoundingClientRect();
    const top = ws.scrollTop + (rect.top - wsRect.top) - Math.max(0, (wsRect.height - rect.height) / 2);
    ws.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    await new Promise((r) => setTimeout(r, 40));
  }

  waitForPage(num, token) {
    const viewer = this.viewer;
    const started = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (token !== this.token) return resolve();
        const pv = viewer.pages?.[num - 1];
        if (pv?.rendered || performance.now() - started > 4000) return resolve();
        setTimeout(tick, 60);
      };
      tick();
    });
  }

  /* ---------------- step content ---------------- */
  clearSide() {
    if (!this.els.side) return;
    this.els.side.hidden = true;
    this.els.side.replaceChildren();
    this.els.side.dataset.kind = '';
  }

  renderStepContent(step) {
    const side = this.els.side;
    if (!side) return;
    side.dataset.kind = step.type;
    const parts = [];

    if (step.title) {
      const h = document.createElement('h2');
      h.className = 'gp-side-title';
      h.textContent = step.title;
      parts.push(h);
    }

    if (step.text) {
      const body = document.createElement('div');
      body.className = 'gp-side-text';
      body.innerHTML = renderRichText(step.text);
      parts.push(body);
    }

    if (step.type === 'checkpoint' || step.checkpoint) {
      const box = document.createElement('div');
      box.className = 'gp-checkpoint';
      box.innerHTML = `<p>${escapeHtml(step.checkpoint?.message || 'Ready to continue?')}</p>`;
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn btn-primary btn-sm';
      go.textContent = step.checkpoint?.label || 'I understand — continue';
      go.addEventListener('click', () => this.next());
      box.append(go);
      parts.push(box);
    }

    if (step.type === 'quiz' && step.quiz) {
      const quiz = createQuizView(step.quiz, {
        onAnswer: ({ correct }) => {
          if (correct !== null) {
            this.score.asked++;
            if (correct) this.score.correct++;
            this.answered.add(step.id);
            this.onScore?.({ ...this.score });
          }
          setTimeout(() => { if (this.playing) this.next(); }, 900);
        }
      });
      parts.push(quiz.el);
      setTimeout(() => quiz.focus(), 120);
    }

    if (step.link?.url) {
      const link = document.createElement('a');
      link.className = 'gp-external';
      link.href = step.link.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.innerHTML = `${icon('external', 'icon-sm')}<span>${escapeHtml(step.link.label || 'Open external resource')}</span><span class="gp-external-host">${escapeHtml(new URL(step.link.url).hostname)}</span>`;
      parts.push(link);
    }

    if (step.narration?.assetId && this.captionsOn && step.text) {
      // captions reuse the explanation text
    }

    if (!parts.length) { side.hidden = true; return; }
    side.replaceChildren(...parts);
    side.hidden = false;
    if (step.text && this.captionsOn) {
      this.els.caption.hidden = false;
      this.els.caption.textContent = step.text.replace(/[#*`]/g, '').slice(0, 240);
    } else {
      this.els.caption.hidden = true;
    }
  }

  renderChrome() {
    const step = this.steps[this.index];
    if (!step) return;
    this.els.step.textContent = String(this.index + 1);
    const pct = ((this.index + 1) / this.steps.length) * 100;
    this.els.bar.style.width = `${pct}%`;
    this.els.progress.setAttribute('aria-valuenow', String(Math.round(pct)));
    this.els.progress.setAttribute('aria-valuetext', `Step ${this.index + 1} of ${this.steps.length}`);
  }

  updatePlayIcon() {
    if (!this.els.playIcon) return;
    this.els.playIcon.innerHTML = this.playing ? icon('minus') : icon('play');
    const btn = this.stage?.querySelector('[data-act="play"]');
    btn?.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
  }

  /* ---------------- controls ---------------- */
  toggle() { this.playing ? this.pause() : this.resume(); }

  pause() {
    this.playing = false;
    this.clearTimer();
    this.narration.pause();
    this.updatePlayIcon();
  }

  resume() {
    this.playing = true;
    this.updatePlayIcon();
    if (this.narration.audio?.src && !this.narration.playing) this.narration.resume();
    const step = this.steps[this.index];
    if (step) this.scheduleAdvance(step, this.token);
  }

  next() {
    if (this.index >= this.steps.length - 1) { this.finish(); return; }
    this.goTo(this.index + 1);
  }

  prev() {
    if (this.index <= 0) { this.goTo(0); return; }
    this.goTo(this.index - 1);
  }

  restart() { this.score = { correct: 0, asked: 0 }; this.answered.clear(); this.playing = true; this.updatePlayIcon(); this.goTo(0); }

  cycleSpeed() {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length];
    if (this.els.speed) this.els.speed.textContent = `${this.speed}×`;
    this.narration.audio.playbackRate = this.speed;
    this.toast(`Playback speed ${this.speed}×`);
  }

  toggleCaptions() {
    this.captionsOn = !this.captionsOn;
    this.els.captions?.setAttribute('aria-pressed', String(this.captionsOn));
    const step = this.steps[this.index];
    if (step) this.renderStepContent(step);
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await this.stage.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch { /* not supported */ }
  }

  finish() {
    this.playing = false;
    this.clearTimer();
    this.narration.stop();
    this.updatePlayIcon();
    const { correct, asked } = this.score;
    const side = this.els.side;
    if (!side) return;
    side.dataset.kind = 'done';
    side.hidden = false;
    side.replaceChildren();
    const box = document.createElement('div');
    box.className = 'gp-done';
    box.innerHTML = `<h2>Tour complete</h2><p>${this.steps.length} steps${asked ? ` · ${correct}/${asked} quiz answers correct` : ''}</p>`;
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn btn-primary btn-sm';
    again.textContent = 'Watch again';
    again.addEventListener('click', () => this.restart());
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-ghost btn-sm';
    close.textContent = 'Exit';
    close.addEventListener('click', () => this.exit());
    const row = document.createElement('div');
    row.className = 'gp-done-actions';
    row.append(again, close);
    box.append(row);
    side.append(box);
  }

  toast(message) {
    if (!this.els.toast) return;
    this.els.toast.textContent = message;
    this.els.toast.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { if (this.els.toast) this.els.toast.hidden = true; }, 3200);
  }

  clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  exit() {
    this.token++;
    this.clearTimer();
    this.narration.release();
    this.spotlight.destroy();
    this.stage?.remove();
    document.body.classList.remove('gp-playing');
    document.removeEventListener('keydown', this.onKey);
    this.viewer?.workspace?.removeEventListener('scroll', this.onScroll);
    this.mounted = false;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    this.onExit?.();
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
