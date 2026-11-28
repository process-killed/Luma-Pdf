/** Voice narration: recording with MediaRecorder and playback with one shared element. */

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'];

export function narrationSupported() {
  return typeof MediaRecorder !== 'undefined' && !!(navigator.mediaDevices?.getUserMedia);
}

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mime of PREFERRED) {
    try { if (MediaRecorder.isTypeSupported(mime)) return mime; } catch { /* ignore */ }
  }
  return '';
}

export class NarrationRecorder {
  constructor() {
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.startedAt = 0;
    this.elapsed = 0;
    this.state = 'idle';
    this.onState = null;
  }

  async start() {
    if (this.state === 'recording') return;
    if (!narrationSupported()) {
      throw new Error('This browser cannot record audio. You can still add narration text.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      throw new Error(denied
        ? 'Microphone permission was denied. Allow the microphone in your browser settings, or use narration text instead.'
        : 'No microphone was found. You can still add narration text.');
    }
    const mimeType = pickMime();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.elapsed = 0;
    this.state = 'recording';
    this.onState?.('recording');
  }

  pause() {
    if (this.state !== 'recording' || !this.recorder) return;
    this.recorder.pause();
    this.elapsed += performance.now() - this.startedAt;
    this.state = 'paused';
    this.onState?.('paused');
  }

  resume() {
    if (this.state !== 'paused' || !this.recorder) return;
    this.recorder.resume();
    this.startedAt = performance.now();
    this.state = 'recording';
    this.onState?.('recording');
  }

  /** Stop and return { blob, mime, duration }. */
  async stop() {
    if (!this.recorder || this.state === 'idle') return null;
    const duration = (this.elapsed + (this.state === 'recording' ? performance.now() - this.startedAt : 0)) / 1000;
    const done = new Promise((resolve) => {
      this.recorder.onstop = () => resolve();
    });
    try { this.recorder.stop(); } catch { /* already stopped */ }
    await done;
    const mime = this.recorder.mimeType || pickMime() || 'audio/webm';
    const blob = new Blob(this.chunks, { type: mime.split(';')[0] });
    this.release();
    this.state = 'idle';
    this.onState?.('idle');
    return { blob, mime: mime.split(';')[0], duration: Math.max(0.2, duration) };
  }

  cancel() {
    try { this.recorder?.stop(); } catch { /* ignore */ }
    this.release();
    this.chunks = [];
    this.state = 'idle';
    this.onState?.('idle');
  }

  /** Always release the microphone: a live track keeps the recording indicator on. */
  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
  }
}

/** One shared audio element, so narration can never overlap itself. */
export class NarrationPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this.url = null;
    this.volume = 1;
  }

  async play(blob, { volume = 1, rate = 1 } = {}) {
    this.stop();
    if (!blob) return null;
    this.release();
    this.url = URL.createObjectURL(blob);
    this.audio.src = this.url;
    this.audio.volume = Math.max(0, Math.min(1, volume));
    this.audio.playbackRate = Math.max(0.5, Math.min(2, rate));
    try {
      await this.audio.play();
    } catch {
      return null; // autoplay blocked — the player shows a play button instead
    }
    return new Promise((resolve) => {
      const done = () => { this.audio.onended = null; resolve('ended'); };
      this.audio.onended = done;
    });
  }

  pause() { try { this.audio.pause(); } catch { /* ignore */ } }
  resume() { this.audio.play().catch(() => {}); }
  setVolume(v) { this.audio.volume = Math.max(0, Math.min(1, v)); this.volume = v; }

  stop() {
    try { this.audio.pause(); this.audio.currentTime = 0; } catch { /* ignore */ }
  }

  release() {
    this.stop();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }

  get playing() { return !this.audio.paused; }
}

/** Measure a recording's length without decoding the whole file. */
export function audioDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = url;
    const done = (value) => { URL.revokeObjectURL(url); resolve(Number.isFinite(value) ? value : 0); };
    probe.onloadedmetadata = () => done(probe.duration);
    probe.onerror = () => done(0);
    setTimeout(() => done(probe.duration), 3000);
  });
}
