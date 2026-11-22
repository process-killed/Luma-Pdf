// Theme + appearance application (theme, reading background, page filter, motion, contrast).
import { store } from './state.js';
import { prefersReducedMotion } from './utils/accessibility.js';

const media = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return media && media.matches ? 'dark' : 'light';
}

export function applyTheme(mode = store.get('theme')) {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0f0f13' : '#fcfcfd');
  return resolved;
}

export function applyAppearance() {
  const root = document.documentElement;
  applyTheme();
  root.dataset.readbg = store.get('readBg') || 'light';
  root.dataset.pagefilter = store.get('pageFilter') || 'none';
  root.dataset.contrast = store.get('contrast') === 'high' ? 'high' : 'normal';
  const motion = store.get('motion');
  root.dataset.motion = motion === 'reduced' || (motion !== 'full' && prefersReducedMotion()) ? 'reduced' : 'auto';
  const perf = store.get('performanceProfile');
  root.dataset.performance = perf && perf !== 'auto' ? perf : (root.dataset.detectedProfile || 'balanced');
}

export function toggleTheme() {
  const current = resolveTheme(store.get('theme'));
  const next = current === 'dark' ? 'light' : 'dark';
  store.set('theme', next);
  applyTheme(next);
  return next;
}

export function watchSystemTheme() {
  if (!media) return;
  const handler = () => { if (store.get('theme') === 'auto') applyTheme('auto'); };
  if (media.addEventListener) media.addEventListener('change', handler);
  else if (media.addListener) media.addListener(handler);
}

export function initTheme() {
  applyAppearance();
  watchSystemTheme();
  store.subscribe(() => applyAppearance());
}
