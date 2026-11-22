// PWA install prompt handling (Chrome/Edge/Android) with iOS instructions.
import { env, supports } from '../utils/browser.js';
import { dialog, toast } from '../ui/ui.js';

let deferredPrompt = null;

export function initInstall() {
  const buttons = () => Array.from(document.querySelectorAll('[data-install-app]'));
  const paint = () => {
    const installed = env.standalone;
    const canPrompt = !!deferredPrompt;
    buttons().forEach((btn) => {
      btn.hidden = installed;
      btn.title = canPrompt ? 'Install Luma PDF' : env.isIOS ? 'Add to Home Screen' : 'How to install this app';
    });
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    paint();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    toast('Luma PDF installed. Open it from your home screen or app list.', { type: 'success' });
    paint();
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-install-app]');
    if (!btn) return;
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
      deferredPrompt = null;
      paint();
      if (choice.outcome === 'accepted') toast('Installing Luma PDF…', { type: 'success' });
      return;
    }
    showInstallHelp();
  });

  paint();
  return { paint };
}

export function showInstallHelp() {
  const ios = env.isIOS;
  return dialog({
    title: ios ? 'Add Luma PDF to your Home Screen' : 'Install Luma PDF',
    sub: ios ? 'iOS Safari installs web apps from the Share menu.' : 'Your browser offers installation from its menu.',
    body: `<ol style="padding-left:18px;font-size:14px;color:var(--text-secondary);line-height:1.75">
      ${ios ? `
        <li>Open this site in <strong>Safari</strong> (Chrome on iOS cannot install web apps).</li>
        <li>Tap the <strong>Share</strong> button in the toolbar.</li>
        <li>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li>
        <li>Luma PDF opens in standalone mode with its own icon.</li>`
      : `
        <li>Open the browser menu (⋮ in Chrome, … in Edge).</li>
        <li>Choose <strong>Install app</strong> or <strong>Apps → Install this site as an app</strong>.</li>
        <li>Confirm. Luma PDF gets its own window and icon.</li>
        <li>If the option is missing, the page must be served over HTTPS.</li>`}
    </ol>
    <p class="hint" style="margin-top:10px">
      iOS and Android do not share an installation API: Android exposes a browser prompt,
      iOS relies on the Share menu. Installation is only offered by browsers that support it.
    </p>`,
    actions: [{ label: 'Got it', value: true, variant: 'primary' }]
  });
}

export const installSupported = () => supports.serviceWorker;
