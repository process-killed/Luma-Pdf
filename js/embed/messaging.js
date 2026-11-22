/**
 * postMessage bridge for embedded viewers.
 * - Only same-origin parents, or origins explicitly listed in `allowOrigins`, may command us.
 * - Nothing received is ever evaluated as code.
 */
import { isKnownCommand, sanitizeMessagePayload, originAllowed, parseAllowedOrigins } from '../utils/security.js';

export const EVENTS = [
  'luma:ready', 'luma:loaded', 'luma:error', 'luma:pageChanged', 'luma:zoomChanged',
  'luma:searchCompleted', 'luma:fullscreenChanged', 'luma:annotationChanged', 'luma:documentInfo'
];

export class EmbedBridge {
  /**
   * @param {object} handlers map of command name -> async function(payload)
   * @param {{allowOrigins?: string[]}} opts
   */
  constructor(handlers = {}, { allowOrigins = [] } = {}) {
    this.handlers = handlers;
    this.allowOrigins = allowOrigins;
    this.parentOrigin = null;
    this.onMessage = this.handleMessage.bind(this);
    this.installed = false;
  }

  install() {
    if (this.installed) return this;
    window.addEventListener('message', this.onMessage);
    this.installed = true;
    return this;
  }

  destroy() {
    window.removeEventListener('message', this.onMessage);
    this.installed = false;
  }

  handleMessage(event) {
    if (event.source !== window.parent && event.source !== window.opener) return;
    if (!originAllowed(event.origin, this.allowOrigins)) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Accept both {type:'luma', command, payload} and {type:'luma:setPage', page: 3}.
    let command = null;
    let payload = null;
    if (typeof data.command === 'string') {
      command = data.command;
      payload = sanitizeMessagePayload(data.payload ?? data.value ?? null);
    } else if (typeof data.type === 'string' && data.type.startsWith('luma:')) {
      command = data.type.slice(5);
      const { type, ...rest } = data;
      payload = sanitizeMessagePayload(rest);
    }
    if (!command || !isKnownCommand(command)) return;
    if (!this.parentOrigin) this.parentOrigin = event.origin;

    const handler = this.handlers[command];
    if (!handler) return;
    Promise.resolve()
      .then(() => handler(payload))
      .then((result) => {
        if (command === 'getDocumentInfo' && result) {
          this.emit('luma:documentInfo', result);
        }
        this.reply(event.origin, event.source, { command, ok: true, result: result ?? null });
      })
      .catch((err) => {
        this.reply(event.origin, event.source, { command, ok: false, error: String(err?.message || err) });
      });
  }

  reply(origin, source, payload) {
    try {
      source.postMessage({ type: 'luma:response', ...payload }, origin);
    } catch { /* ignore */ }
  }

  /** Send a viewer event to the parent (or to a specific target origin). */
  emit(type, detail = {}) {
    if (!EVENTS.includes(type)) return;
    if (window.parent === window) return;
    const target = this.parentOrigin || this.allowOrigins[0] || location.origin;
    try {
      window.parent.postMessage({ type, detail, version: '1.0.0' }, target);
    } catch { /* ignore */ }
  }
}

export function allowedOriginsFromParams(params) {
  return parseAllowedOrigins(params.get('origin') || params.get('allowOrigins') || '');
}
