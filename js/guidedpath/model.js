/**
 * GuidedPath data model: step factories, validation, normalisation and migration.
 * Everything here is pure data — no DOM, no storage — so it can be unit tested.
 */
import { GUIDEDPATH } from '../config.js';

export const STEP_TYPES = {
  page: { label: 'Page navigation', icon: 'file', color: 'nav' },
  zoom: { label: 'Smart zoom', icon: 'zoom-in', color: 'zoom' },
  spotlight: { label: 'Spotlight', icon: 'crosshair', color: 'spot' },
  text: { label: 'Explanation', icon: 'file-text', color: 'text' },
  narration: { label: 'Voice narration', icon: 'mic', color: 'voice' },
  focus: { label: 'Image focus', icon: 'image', color: 'zoom' },
  checkpoint: { label: 'Checkpoint', icon: 'check', color: 'check' },
  quiz: { label: 'Quiz', icon: 'info', color: 'quiz' },
  link: { label: 'External resource', icon: 'link', color: 'link' }
};

export const QUIZ_KINDS = {
  choice: 'Multiple choice',
  boolean: 'True / false',
  short: 'Short answer'
};

let counter = 0;
export function newId(prefix = 'gp') {
  counter = (counter + 1) % 100000;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** A rectangle in normalised page coordinates (0..1 of the page box). */
export function normalizeRegion(region = {}) {
  const x = clamp01(region.x);
  const y = clamp01(region.y);
  const w = Math.max(0.001, Math.min(1 - x, Number(region.w) || 0.2));
  const h = Math.max(0.001, Math.min(1 - y, Number(region.h) || 0.1));
  return {
    x, y, w, h,
    r: Math.max(0, Math.min(1, Number(region.r) || 0))
  };
}

export function createStep(type, patch = {}) {
  const base = {
    id: newId('step'),
    type,
    page: 1,
    title: '',
    text: '',
    duration: 3000,
    zoom: null,
    spotlight: null,
    narration: null,
    quiz: null,
    checkpoint: null,
    link: null,
    createdAt: Date.now()
  };
  const step = { ...base, ...patch, type };
  if (step.zoom) step.zoom = normalizeZoom(step.zoom);
  if (step.spotlight) step.spotlight = normalizeSpotlight(step.spotlight);
  if (step.quiz) step.quiz = normalizeQuiz(step.quiz);
  return step;
}

export function normalizeZoom(zoom = {}) {
  return {
    scale: Math.max(0.2, Math.min(8, Number(zoom.scale) || 1.5)),
    x: clamp01(zoom.x ?? 0.5),
    y: clamp01(zoom.y ?? 0.5),
    transition: Math.max(0, Math.min(4000, Number(zoom.transition) || 650))
  };
}

export function normalizeSpotlight(spot = {}) {
  const regions = Array.isArray(spot.regions) && spot.regions.length
    ? spot.regions.slice(0, 12).map(normalizeRegion)
    : [normalizeRegion({ x: 0.1, y: 0.1, w: 0.8, h: 0.3 })];
  return {
    regions,
    opacity: Math.max(0, Math.min(0.95, spot.opacity ?? 0.55)),
    border: Math.max(0, Math.min(8, spot.border ?? 2)),
    animate: spot.animate !== false
  };
}

export function normalizeQuiz(quiz = {}) {
  const kind = QUIZ_KINDS[quiz.kind] ? quiz.kind : 'choice';
  const options = kind === 'short' ? [] : (quiz.options || ['', '']).slice(0, 6).map((o) => String(o ?? '').slice(0, 400));
  let answer = quiz.answer ?? 0;
  if (kind === 'boolean') answer = quiz.answer === true || quiz.answer === 1 || quiz.answer === 'true' ? 1 : 0;
  if (kind === 'choice') answer = Math.max(0, Math.min(Math.max(0, options.length - 1), Number(answer) || 0));
  if (kind === 'short') answer = String(quiz.answer ?? '').slice(0, 400);
  return {
    kind,
    question: String(quiz.question ?? '').slice(0, 1000),
    options,
    answer,
    explanation: String(quiz.explanation ?? '').slice(0, 2000)
  };
}

/** Validate one step from an imported file. Throws on anything unusable. */
export function validateStep(raw, pageCount = 0) {
  if (!raw || typeof raw !== 'object') throw new Error('Step is not an object.');
  const type = STEP_TYPES[raw.type] ? raw.type : 'page';
  const page = Number(raw.page);
  if (!Number.isFinite(page) || page < 1) throw new Error('Step has no valid page.');
  const step = createStep(type, {
    id: typeof raw.id === 'string' && raw.id.length < 80 ? raw.id : newId('step'),
    page: pageCount ? Math.min(pageCount, Math.max(1, Math.round(page))) : Math.round(page),
    title: String(raw.title ?? '').slice(0, 200),
    text: String(raw.text ?? '').slice(0, GUIDEDPATH.maxTextLength),
    duration: Math.max(400, Math.min(120000, Number(raw.duration) || 3000)),
    zoom: raw.zoom ? normalizeZoom(raw.zoom) : null,
    spotlight: raw.spotlight ? normalizeSpotlight(raw.spotlight) : null,
    quiz: raw.quiz ? normalizeQuiz(raw.quiz) : null,
    checkpoint: raw.checkpoint ? { message: String(raw.checkpoint.message ?? '').slice(0, 500), label: String(raw.checkpoint.label ?? '').slice(0, 120) } : null,
    link: raw.link && typeof raw.link.url === 'string' ? { url: safeExternalUrl(raw.link.url), label: String(raw.link.label ?? '').slice(0, 200) } : null,
    narration: raw.narration && typeof raw.narration.assetId === 'string'
      ? {
        assetId: raw.narration.assetId.slice(0, 120),
        mime: GUIDEDPATH.narrationMimes.includes(raw.narration.mime) ? raw.narration.mime : 'audio/webm',
        duration: Math.max(0, Number(raw.narration.duration) || 0),
        volume: Math.max(0, Math.min(1, raw.narration.volume ?? 1))
      }
      : null,
    createdAt: Number(raw.createdAt) || Date.now()
  });
  return step;
}

/** Only http(s) links are ever allowed out of a tour. */
export function safeExternalUrl(url) {
  try {
    const parsed = new URL(String(url), 'https://invalid.local');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/** Plain-text renderer for explanation panels: supports headings, lists, bold, links. */
export function renderRichText(text = '') {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) =>
      `<a href="${safeExternalUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);

  const lines = String(text).replace(/\r/g, '').split('\n');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { closeList(); continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(t);
    if (heading) { closeList(); const lvl = heading[1].length + 2; out.push(`<h${lvl}>${inline(heading[2])}</h${lvl}>`); continue; }
    const bullet = /^[-*]\s+(.*)$/.exec(t);
    if (bullet) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(bullet[1])}</li>`); continue; }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ordered) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(ordered[1])}</li>`); continue; }
    closeList();
    out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  return out.join('');
}

/** Total tour duration in ms (auto-advance steps only). */
export function tourDuration(steps = []) {
  return steps.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
}

/** Migrate an older tour record to the current shape. */
export function migrateTour(tour) {
  if (!tour || typeof tour !== 'object') throw new Error('Tour is not an object.');
  const steps = Array.isArray(tour.steps) ? tour.steps : [];
  return {
    ...tour,
    formatVersion: GUIDEDPATH.formatVersion,
    steps: steps.map((s) => { try { return validateStep(s, tour.pageCount || 0); } catch { return null; } }).filter(Boolean)
  };
}
