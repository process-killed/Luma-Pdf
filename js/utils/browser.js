// Feature detection and environment reporting.
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

export const env = {
  isIOS: /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  isAndroid: /Android/.test(ua),
  isSafari: /^((?!chrome|android|crios|fxios).)*safari/i.test(ua),
  isFirefox: /Firefox|FxiOS/.test(ua),
  isEdge: /Edg\//.test(ua),
  isChrome: /Chrome|CriOS/.test(ua) && !/Edg\//.test(ua),
  isTouch: typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches,
  standalone: (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone === true)
};

export const supports = {
  indexedDB: (() => { try { return !!window.indexedDB; } catch { return false; } })(),
  serviceWorker: 'serviceWorker' in navigator,
  fileSystemAccess: 'showOpenFilePicker' in window,
  webShare: !!(navigator.share),
  webShareFiles: !!(navigator.canShare),
  offscreenCanvas: 'OffscreenCanvas' in window,
  resizeObserver: 'ResizeObserver' in window,
  intersectionObserver: 'IntersectionObserver' in window,
  webp: (() => {
    try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; }
  })(),
  structuredClone: typeof structuredClone === 'function',
  crypto: !!(window.crypto && window.crypto.subtle),
  pwaInstall: 'onbeforeinstallprompt' in window
};

export function deviceInfo() {
  const mem = navigator.deviceMemory || null;
  const cores = navigator.hardwareConcurrency || null;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  return {
    memoryGB: mem,
    cores,
    dpr: window.devicePixelRatio || 1,
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    connection: conn ? { type: conn.effectiveType, downlink: conn.downlink, saveData: !!conn.saveData } : null,
    touch: env.isTouch,
    platform: navigator.platform || '',
    ua
  };
}

export function browserLabel() {
  if (env.isEdge) return 'Edge';
  if (env.isFirefox) return 'Firefox';
  if (env.isSafari) return 'Safari';
  if (env.isChrome) return 'Chrome';
  return 'Browser';
}
