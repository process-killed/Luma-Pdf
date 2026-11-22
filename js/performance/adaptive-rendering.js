// Render scaling maths: keeps canvas pixel counts inside the profile budget.
import { clamp } from '../utils/dom.js';

/**
 * @param {{width:number,height:number}} pageSize CSS size of the page at scale 1
 * @param {number} targetWidth CSS width the page should occupy
 * @param {object} profile performance profile config
 * @param {number} dpr window.devicePixelRatio
 */
export function computeRenderPlan(pageSize, targetWidth, profile, dpr) {
  const cssScale = targetWidth / pageSize.width;
  const cssWidth = pageSize.width * cssScale;
  const cssHeight = pageSize.height * cssScale;
  let ratio = Math.min(dpr || 1, profile.maxDevicePixelRatio || 1.5);
  const budget = profile.maxCanvasPixels || 4_000_000;
  let pixels = cssWidth * cssHeight * ratio * ratio;
  if (pixels > budget) ratio = Math.sqrt(budget / (cssWidth * cssHeight));
  ratio = clamp(ratio, 0.35, profile.maxDevicePixelRatio || 2);
  return {
    scale: cssScale,
    outputScale: ratio,
    cssWidth: Math.round(cssWidth),
    cssHeight: Math.round(cssHeight),
    canvasWidth: Math.max(1, Math.round(cssWidth * ratio)),
    canvasHeight: Math.max(1, Math.round(cssHeight * ratio))
  };
}

/** Effective max canvas pixels for a profile, with a hard safety ceiling. */
export function pixelBudget(profile) {
  return Math.min(profile.maxCanvasPixels || 4_000_000, 16_000_000);
}
