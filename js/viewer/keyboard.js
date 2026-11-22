/**
 * Keyboard shortcuts — configurable bindings, ignored while typing in form fields.
 */
import { SHORTCUTS } from '../config.js';
import { isTypingTarget } from '../utils/accessibility.js';

export function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  let key = e.key;
  if (!key) return '';
  if (key === ' ') key = 'space';
  parts.push(key.toLowerCase());
  return parts.join('+');
}

function candidates(e) {
  const list = new Set([comboFromEvent(e)]);
  // Allow bindings written without shift for characters that require it.
  const noShift = [];
  if (e.ctrlKey || e.metaKey) noShift.push('ctrl');
  if (e.altKey) noShift.push('alt');
  noShift.push(String(e.key || '').toLowerCase());
  list.add(noShift.join('+'));
  if (e.key === '+') list.add('ctrl++');
  if (e.key === '=') { list.add('ctrl+='); list.add('ctrl+shift+='); }
  return list;
}

export class KeyController {
  constructor(actions, { enabled = true } = {}) {
    this.actions = actions;
    this.enabled = enabled;
    this.binding = { ...SHORTCUTS };
    this.handler = this.handle.bind(this);
  }

  attach(target = document) {
    this.target = target;
    target.addEventListener('keydown', this.handler);
    return this;
  }

  destroy() {
    this.target?.removeEventListener('keydown', this.handler);
  }

  handle(e) {
    if (!this.enabled) return;
    if (e.defaultPrevented) return;
    const typing = isTypingTarget(e.target);
    const combos = candidates(e);

    for (const [action, keys] of Object.entries(this.binding)) {
      const list = Array.isArray(keys) ? keys : [keys];
      if (!list.some((k) => combos.has(String(k).toLowerCase()))) continue;
      // While typing, only allow modifiers + Escape.
      if (typing && !(action === 'escape' || combos.has('ctrl+' + (e.key || '').toLowerCase()))) {
        if (!['search', 'print', 'save'].includes(action)) continue;
      }
      const fn = this.actions[action];
      if (!fn) continue;
      e.preventDefault();
      fn(e);
      return;
    }

    // Extra single-key actions that are not in the default map.
    if (!typing) {
      if (combos.has('z')) this.actions.zen?.();
      if (combos.has('shift+?')) this.actions.help?.();
    }
  }
}
