// Accessibility utilities: live announcements, reduced motion, focus restore.
let liveRegion = null;

export function announce(message, politeness = 'polite') {
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('aria-live', politeness);
    liveRegion.setAttribute('aria-atomic', 'true');
    document.body.append(liveRegion);
  }
  liveRegion.setAttribute('aria-live', politeness);
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = message; }, 40);
}

export function prefersReducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function focusFirst(container) {
  if (!container) return;
  const target = container.querySelector('[autofocus], input, button, [href]');
  if (target) target.focus();
}

export function restoreFocus(el) {
  if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
}

/** Keyboard handler that ignores events originating in form fields. */
export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
