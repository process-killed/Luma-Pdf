// Device capability detection and performance profile selection.
import { deviceInfo, env, supports } from '../utils/browser.js';
import { PERFORMANCE } from '../config.js';

export function detectDevice() {
  const info = deviceInfo();
  const weak = (
    (info.memoryGB !== null && info.memoryGB <= 2) ||
    (info.cores !== null && info.cores <= 2) ||
    (info.connection && ['slow-2g', '2g'].includes(info.connection.type)) ||
    (info.connection && info.connection.saveData)
  );
  let isMobile = false;
  try {
    isMobile = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      Math.min(window.innerWidth, window.innerHeight) < 560;
  } catch { /* desktop */ }
  return { ...info, weak, isMobile, supports };
}

/** Phones and tablets render fewer pixels: the eye cannot tell at 400 ppi. */
export function mobileCap(profile, info = detectDevice()) {
  if (!info.isMobile) return profile;
  return {
    ...profile,
    maxDevicePixelRatio: Math.min(profile.maxDevicePixelRatio, 1.5),
    maxCanvasPixels: Math.min(profile.maxCanvasPixels, 3_000_000),
    cachePages: Math.min(profile.cachePages, 3)
  };
}

export function recommendProfile(info = detectDevice()) {
  if (info.weak) return 'eco';
  if ((info.memoryGB && info.memoryGB >= 8) && (info.cores || 0) >= 8 && (info.dpr || 1) <= 2.5) return 'performance';
  return 'balanced';
}

export function profileConfig(name) {
  const key = PERFORMANCE.profiles.includes(name) ? name : 'balanced';
  return { name: key, ...PERFORMANCE[key] };
}

/** Best guess for the reader UI language from the browser. */
export function uiLanguage() {
  const l = (navigator.language || 'en').split('-')[0];
  return l;
}

export { env };
