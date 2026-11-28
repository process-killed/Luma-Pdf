/**
 * Coordinate maths. Tours store everything as normalised page coordinates (0..1) so a
 * step recorded on a phone lands in the same place on a desktop monitor.
 */

/** A page's annotation layer is exactly the page box, so its rect is the reference. */
export function pageRect(pv) {
  const el = pv?.annotEl || pv?.wrap;
  return el ? el.getBoundingClientRect() : null;
}

/** Viewport pixels → normalised page coordinates. */
export function toNormalized(pv, clientX, clientY) {
  const rect = pageRect(pv);
  if (!rect || !rect.width || !rect.height) return null;
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
  };
}

/** Normalised page coordinates → viewport pixels. */
export function toPixels(pv, point) {
  const rect = pageRect(pv);
  if (!rect) return null;
  return {
    x: rect.left + point.x * rect.width,
    y: rect.top + point.y * rect.height
  };
}

/** Normalised region → CSS box relative to the page element. */
export function regionToBox(region) {
  const r = region || {};
  return {
    left: `${(r.x ?? 0) * 100}%`,
    top: `${(r.y ?? 0) * 100}%`,
    width: `${(r.w ?? 0.2) * 100}%`,
    height: `${(r.h ?? 0.1) * 100}%`,
    borderRadius: `${(r.r ?? 0) * 50}%`
  };
}

/** True when two normalised regions overlap at all. */
export function regionsOverlap(a, b, pad = 0.01) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}

/** Merge touching regions so a drag across several lines becomes one rectangle. */
export function mergeRegions(regions = [], pad = 0.004) {
  const list = regions.slice().sort((a, b) => a.y - b.y);
  const out = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && regionsOverlap(last, r, pad)) {
      const x1 = Math.min(last.x, r.x);
      const y1 = Math.min(last.y, r.y);
      const x2 = Math.max(last.x + last.w, r.x + r.w);
      const y2 = Math.max(last.y + last.h, r.y + r.h);
      out[out.length - 1] = { x: x1, y: y1, w: x2 - x1, h: y2 - y1, r: Math.max(last.r || 0, r.r || 0) };
    } else out.push({ ...r });
  }
  return out;
}

/**
 * Work out the scale and scroll offset that frames a normalised region, leaving a small
 * margin. Returns values the viewer can apply directly.
 */
export function frameForRegion(pv, region, { padding = 0.12, maxScale = 4 } = {}) {
  const wrap = pv?.wrap;
  const workspace = wrap?.closest('.workspace');
  if (!wrap || !workspace) return null;
  const wsRect = workspace.getBoundingClientRect();
  const pageRect = wrap.getBoundingClientRect();
  const baseWidth = pv.baseSize?.width || 1;
  const baseHeight = pv.baseSize?.height || 1;

  const regionW = Math.max(0.02, region.w);
  const regionH = Math.max(0.02, region.h);
  const availW = wsRect.width * (1 - padding * 2);
  const availH = wsRect.height * (1 - padding * 2);
  const scaleW = availW / (baseWidth * regionW);
  const scaleH = availH / (baseHeight * regionH);
  const scale = Math.max(0.3, Math.min(maxScale, Math.min(scaleW, scaleH)));

  // centre of the region inside the *unscaled* page
  const cx = (region.x + regionW / 2) * baseWidth * scale;
  const cy = (region.y + regionH / 2) * baseHeight * scale;

  return {
    scale,
    // scroll positions that put the region centre in the middle of the workspace.
    // Both axes use the same rect-based maths, so they agree with each other.
    scrollLeft: Math.max(0, pageRect.left - wsRect.left + workspace.scrollLeft + cx - wsRect.width / 2),
    scrollTop: Math.max(0, pageRect.top - wsRect.top + workspace.scrollTop + cy - wsRect.height / 2),
    pageNum: pv.num
  };
}

/** Keep normalised rectangles sane when they come from an untrusted file. */
export function sanitizeRegions(regions = []) {
  return regions
    .filter((r) => r && Number.isFinite(Number(r.x)) && Number.isFinite(Number(r.y)))
    .slice(0, 12)
    .map((r) => {
      const x = Math.max(0, Math.min(1, Number(r.x)));
      const y = Math.max(0, Math.min(1, Number(r.y)));
      return {
        x,
        y,
        w: Math.max(0.005, Math.min(1 - x, Number(r.w) || 0.2)),
        h: Math.max(0.005, Math.min(1 - y, Number(r.h) || 0.1)),
        r: Math.max(0, Math.min(1, Number(r.r) || 0))
      };
    });
}
