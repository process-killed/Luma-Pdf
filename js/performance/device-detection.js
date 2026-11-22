// Device capability detection and performance profile selection.
import { deviceInfo, env, supports } from '../utils/browser.js';
import { PERFORMANCE } from '../config.js';

export function detectDevice() {
  const info = deviceInfo();
  const weak = (
    (info.memoryGB !== null && info.memoryGB <= 3) ||
    (info.cores !== null && info.cores <= 4) ||
    (info.connection && ['slow-2g', '2g', '3g'].includes(info.connection.type)) ||
    (info.connection && info.connection.saveData) ||
    (info.dpr > 2.6)
  );
  return { ...info, weak, supports };
}

export function recommendProfile(info = detectDevice()) {
  if (info.weak) return 'eco';
  if ((info.memoryGB && info.memoryGB >= 8) && (info.cores || 0) >= 8) return 'performance';
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
