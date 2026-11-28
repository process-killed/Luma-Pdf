// Shared chrome: brand mark, header, footer, build stamp.
import { APP, ASSET_V } from './config.js';
import { store } from './state.js';
import { applyAppearance, toggleTheme, resolveTheme } from './theme.js';
import { icon } from './ui/icons.js';
import { initMenus } from './ui/ui.js';

export const NAV = [
  { href: 'viewer.html', label: 'Viewer', key: 'viewer' },
  { href: 'guidedpath.html', label: 'GuidedPath', key: 'guidedpath' },
  { href: 'tools.html', label: 'Tools', key: 'tools' },
  { href: 'editor.html', label: 'Editor', key: 'editor' },
  { href: 'embed-generator.html', label: 'Embed', key: 'embed' },
  { href: 'docs.html', label: 'Developers', key: 'docs' },
  { href: 'library.html', label: 'Library', key: 'library' }
];

export function brandMark(extraClass = '') {
  return `<svg class="brand-mark ${extraClass}" viewBox="0 0 32 32" role="img" aria-label="Luma PDF">
    <defs>
      <linearGradient id="luma-mark-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8a6ee8"/><stop offset="0.55" stop-color="#6e56cf"/><stop offset="1" stop-color="#e8a94a"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8.5" fill="url(#luma-mark-grad)"/>
    <path d="M10.6 8h6.9l4.9 4.8V23a1.4 1.4 0 0 1-1.4 1.4H10.6A1.4 1.4 0 0 1 9.2 23V9.4A1.4 1.4 0 0 1 10.6 8z" fill="#fff" fill-opacity=".96"/>
    <path d="M17.5 8 22.4 12.8h-4.9z" fill="#ded5fb"/>
    <path d="M12.4 15.1h5.2M12.4 18.2h3.6" stroke="#6e56cf" stroke-width="1.35" stroke-linecap="round"/>
    <circle cx="23.2" cy="9.1" r="2.1" fill="#fff" fill-opacity=".9"/>
  </svg>`;
}

export function brandBlock({ sub = 'PDF' } = {}) {
  return `<a class="brand" href="index.html" aria-label="Luma PDF home">
    ${brandMark()}
    <span>Luma<span style="font-weight:400;opacity:.75"> PDF</span></span>
    ${sub ? `<span class="brand-sub">${sub}</span>` : ''}
  </a>`;
}

export function mountHeader({ active = '', minimal = false } = {}) {
  const host = document.querySelector('[data-shell="header"]');
  if (!host) return;
  const navHtml = minimal ? '' : `<nav class="nav" aria-label="Main">${NAV.map((n) =>
    `<a href="${n.href}" ${n.key === active ? 'aria-current="page"' : ''}>${n.label}</a>`).join('')}</nav>`;

  host.className = 'site-header';
  host.innerHTML = `<div class="container">
    ${brandBlock({ sub: '' })}
    ${navHtml}
    <div class="header-actions">
      <button class="btn btn-ghost btn-icon btn-sm" data-theme-toggle aria-label="Toggle dark mode" title="Toggle theme">${icon('moon', 'icon-sm')}</button>
      <button class="btn btn-outline btn-sm hide-sm" data-install-app hidden>${icon('download', 'icon-sm')}<span>Install</span></button>
      <a class="btn btn-primary btn-sm" href="viewer.html">${icon('file-text', 'icon-sm')}<span>Open PDF</span></a>
      <button class="btn btn-ghost btn-icon btn-sm nav-mobile-toggle" data-mobile-nav aria-label="Open menu" aria-expanded="false">${icon('menu', 'icon-sm')}</button>
    </div>
  </div>`;

  const themeBtn = host.querySelector('[data-theme-toggle]');
  const paintThemeBtn = () => {
    const dark = resolveTheme(store.get('theme')) === 'dark';
    themeBtn.innerHTML = icon(dark ? 'sun' : 'moon', 'icon-sm');
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  };
  paintThemeBtn();
  themeBtn.addEventListener('click', () => { toggleTheme(); paintThemeBtn(); });

  const navToggle = host.querySelector('[data-mobile-nav]');
  navToggle?.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!open));
    let sheetNav = document.querySelector('.mobile-nav-sheet');
    if (open) { sheetNav?.remove(); return; }
    sheetNav = document.createElement('div');
    sheetNav.className = 'mobile-nav-sheet';
    sheetNav.style.cssText = 'position:fixed;inset:56px 0 auto 0;z-index:45;background:var(--bg-elevated);border-bottom:1px solid var(--surface-border);padding:8px;display:flex;flex-direction:column;gap:2px;box-shadow:var(--shadow-md)';
    navHtmlInto(sheetNav, active);
    document.body.append(sheetNav);
    sheetNav.addEventListener('click', (e) => {
      if (e.target.closest('a')) { sheetNav.remove(); navToggle.setAttribute('aria-expanded', 'false'); }
    });
  });
  document.addEventListener('click', (e) => {
    const sheetNav = document.querySelector('.mobile-nav-sheet');
    if (sheetNav && !sheetNav.contains(e.target) && !e.target.closest('[data-mobile-nav]')) {
      sheetNav.remove();
      navToggle?.setAttribute('aria-expanded', 'false');
    }
  });
  initMenus();
}

function navHtmlInto(host, active) {
  NAV.forEach((n) => {
    const a = document.createElement('a');
    a.href = n.href;
    a.textContent = n.label;
    a.style.cssText = 'padding:11px 12px;border-radius:8px;font-size:14px;color:var(--text-secondary)';
    if (n.key === active) a.style.background = 'var(--bg-hover)';
    host.append(a);
  });
  const settings = document.createElement('a');
  settings.href = 'settings.html';
  settings.textContent = 'Settings';
  settings.style.cssText = 'padding:11px 12px;border-radius:8px;font-size:14px;color:var(--text-secondary)';
  host.append(settings);
}

export function mountFooter() {
  const host = document.querySelector('[data-shell="footer"]');
  if (!host) return;
  host.className = 'site-footer';
  host.innerHTML = `<div class="container">
    <div class="footer-grid">
      <div class="footer-col">
        ${brandBlock({ sub: '' })}
        <p style="font-size:13px;color:var(--text-muted);margin-top:10px;max-width:34ch;line-height:1.6">
          A universal PDF workspace that runs entirely in your browser. No account, no uploads, no server round-trips.
        </p>
      </div>
      <div class="footer-col">
        <h4>Product</h4>
        <a href="viewer.html">PDF Viewer</a>
        <a href="tools.html">PDF Tools</a>
        <a href="editor.html">PDF Editor</a>
        <a href="library.html">Local Library</a>
        <a href="settings.html">Settings</a>
      </div>
      <div class="footer-col">
        <h4>Developers</h4>
        <a href="embed-generator.html">Embed Generator</a>
        <a href="docs.html#embedding">Embedding guide</a>
        <a href="docs.html#api">JavaScript API</a>
        <a href="docs.html#deployment">Deployment</a>
        <a href="docs.html#security">Security</a>
      </div>
      <div class="footer-col">
        <h4>Resources</h4>
        <a href="docs.html#cors">CORS &amp; remote PDFs</a>
        <a href="docs.html#performance">Performance</a>
        <a href="docs.html#testing">Testing</a>
        <a href="about.html">About &amp; privacy</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${new Date().getFullYear()} Luma PDF · Runs locally in your browser</span>
      <span class="build-stamp" data-build-stamp>v${APP.version} · build ${APP.build}</span>
    </div>
  </div>`;
}

export function mountShell(opts = {}) {
  mountHeader(opts);
  mountFooter();
  applyAppearance();
  document.querySelectorAll('[data-build-stamp]').forEach((n) => { n.textContent = `v${APP.version} · build ${APP.build}`; });
}

/** Inject the asset-version query onto local css/js links that lack one. */
export function versionAssets() {
  document.querySelectorAll('link[rel="stylesheet"][href], script[src]').forEach((node) => {
    const attr = node.tagName === 'LINK' ? 'href' : 'src';
    const val = node.getAttribute(attr);
    if (!val || /^(https?:)?\/\//.test(val) || val.includes('v=')) return;
    node.setAttribute(attr, `${val}?v=${ASSET_V}`);
  });
}
