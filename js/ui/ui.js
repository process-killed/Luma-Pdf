// UI primitives: toasts, dialogs, menus, sheets, clipboard.
import { el, trapFocus } from '../utils/dom.js';
import { icon } from './icons.js';
import { announce } from '../utils/accessibility.js';

let toastHost = null;

function ensureToastHost() {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  return toastHost;
}

/**
 * Show a transient notification.
 * @param {string} message
 * @param {{type?:'info'|'success'|'error'|'warn', title?:string, duration?:number, action?:{label:string,onClick:Function}}} opts
 */
export function toast(message, opts = {}) {
  const { type = 'info', title = '', duration = type === 'error' ? 7000 : 3800, action } = opts;
  const host = ensureToastHost();
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'info';
  const node = el('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' });
  node.innerHTML = `
    <span class="toast-icon">${icon(iconName, 'icon-sm')}</span>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${escape(title)}</div>` : ''}
      <div class="toast-msg">${escape(message)}</div>
      ${action ? `<button class="toast-action" type="button" style="margin-top:6px;font-size:11.5px;color:#b9a9ff;font-weight:600">${escape(action.label)}</button>` : ''}
    </div>
    <button class="toast-close" type="button" aria-label="Dismiss notification">${icon('x', 'icon-sm')}</button>`;
  host.append(node);
  announce(`${title ? title + '. ' : ''}${message}`, type === 'error' ? 'assertive' : 'polite');

  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  };
  node.querySelector('.toast-close').addEventListener('click', close);
  if (action) node.querySelector('.toast-action').addEventListener('click', () => { action.onClick(); close(); });
  if (duration > 0) timer = setTimeout(close, duration);
  return { close };
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Modal dialog built on <dialog>.
 * @returns {Promise<any>} resolves with the chosen value, or null when dismissed.
 */
export function dialog({ title, sub = '', body = '', actions = [], width = '', dismissible = true, onMount }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    if (width) dlg.style.width = `min(92vw, ${width})`;
    dlg.innerHTML = `
      <div class="modal-head">
        <div>
          <div class="modal-title">${escape(title)}</div>
          ${sub ? `<div class="modal-sub">${escape(sub)}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close dialog">${icon('x', 'icon-sm')}</button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>`;
    const bodyEl = dlg.querySelector('.modal-body');
    if (body instanceof Node) bodyEl.append(body);
    else bodyEl.innerHTML = body;
    const foot = dlg.querySelector('.modal-foot');
    let result = null;

    const finish = (value) => {
      result = value;
      dlg.close();
    };

    (actions.length ? actions : [{ label: 'Close', value: null, variant: 'ghost' }]).forEach((a) => {
      const btn = el('button', {
        class: `btn ${a.variant === 'primary' ? 'btn-primary' : a.variant === 'danger' ? 'btn-danger' : 'btn-ghost'}`,
        type: 'button',
        text: a.label
      });
      btn.addEventListener('click', () => {
        if (a.onClick) {
          const r = a.onClick(dlg);
          if (r === false) return;
        }
        finish(a.value !== undefined ? a.value : a.label);
      });
      foot.append(btn);
    });

    dlg.querySelector('[data-close]').addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (e) => { if (!dismissible) e.preventDefault(); });
    dlg.addEventListener('close', () => {
      release();
      dlg.remove();
      resolve(result);
    });

    document.body.append(dlg);
    const release = trapFocus(dlg, { onEscape: () => { if (dismissible) finish(null); } });
    dlg.showModal();
    if (onMount) onMount(dlg);
    setTimeout(() => {
      const first = dlg.querySelector('[autofocus], .modal-body input, .modal-body select, .modal-body textarea, .modal-foot .btn-primary');
      if (first) first.focus();
    }, 30);
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return dialog({
    title,
    body: `<p style="font-size:14px;color:var(--text-secondary);line-height:1.6">${escape(message)}</p>`,
    actions: [
      { label: cancelLabel, value: false, variant: 'ghost' },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary' }
    ]
  }).then((v) => v === true);
}

export function promptDialog({ title, label, value = '', placeholder = '', type = 'text', confirmLabel = 'Save' }) {
  const input = el('input', { class: 'input', type, value, placeholder });
  const body = el('div', { class: 'field' }, el('label', { class: 'label', text: label }), input);
  return dialog({
    title,
    body,
    actions: [
      { label: 'Cancel', value: null, variant: 'ghost' },
      { label: confirmLabel, value: 'ok', variant: 'primary', onClick: () => true }
    ]
  }).then((r) => (r === 'ok' ? input.value : null));
}

/* ---------- Popup menus ---------- */
export function initMenus(root = document) {
  const closeAll = (except) => {
    root.querySelectorAll('.menu[data-open="true"]').forEach((m) => {
      if (m !== except) {
        m.dataset.open = 'false';
        m.parentElement?.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false');
      }
    });
  };
  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-menu-trigger]');
    if (trigger) {
      const host = trigger.closest('.menu-host');
      const menu = host?.querySelector('.menu');
      if (!menu) return;
      const open = menu.dataset.open === 'true';
      closeAll(menu);
      menu.dataset.open = open ? 'false' : 'true';
      trigger.setAttribute('aria-expanded', String(!open));
      if (!open) document.dispatchEvent(new CustomEvent('luma:menu-open'));
      e.preventDefault();
      return;
    }
    if (!e.target.closest('.menu')) closeAll();
    const item = e.target.closest('.menu-item');
    if (item) {
      const menu = item.closest('.menu');
      if (menu) {
        menu.dataset.open = 'false';
        menu.parentElement?.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false');
      }
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}

/* ---------- Bottom sheet (mobile) ---------- */
export function openSheet({ title, content, onClose }) {
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <div class="sheet-head">
      <span class="sheet-title">${escape(title)}</span>
      <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close">${icon('x', 'icon-sm')}</button>
    </div>
    <div class="sheet-body"></div>`;
  const body = sheet.querySelector('.sheet-body');
  if (content instanceof Node) body.append(content);
  else body.innerHTML = content;
  document.body.append(backdrop, sheet);
  requestAnimationFrame(() => { backdrop.dataset.open = 'true'; sheet.dataset.open = 'true'; });

  const close = () => {
    backdrop.dataset.open = 'false';
    sheet.dataset.open = 'false';
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, 260);
    onClose?.();
  };
  sheet.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  return { close, element: sheet };
}

/* ---------- Clipboard ---------- */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Copy-to-clipboard button that reports the result inline. */
export function attachCopyButtons(root = document) {
  root.querySelectorAll('[data-copy]').forEach((btn) => {
    if (btn.dataset.copyBound) return;
    btn.dataset.copyBound = '1';
    btn.addEventListener('click', async () => {
      const target = btn.getAttribute('data-copy');
      const node = target ? document.querySelector(target) : btn.closest('.codeblock')?.querySelector('pre');
      const text = node?.textContent || '';
      const ok = await copyText(text);
      const old = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      setTimeout(() => { btn.textContent = old; }, 1600);
      if (ok) toast('Copied to clipboard', { type: 'success', duration: 1800 });
    });
  });
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${label ? `<span>${escape(label)}</span>` : ''}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}
