// Documentation page: shell, copy buttons and active-section highlighting.
import { boot } from '../app.js';
import { attachCopyButtons, initMenus } from '../ui/ui.js';

await boot({ active: 'docs' });
initMenus();
attachCopyButtons(document);

const links = Array.from(document.querySelectorAll('.docs-nav a[href^="#"]'));
const sections = links
  .map((a) => document.querySelector(a.getAttribute('href')))
  .filter(Boolean);

function paint() {
  const offset = 120;
  let active = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top - offset <= 0) active = section;
  }
  links.forEach((a) => {
    const on = a.getAttribute('href') === '#' + active?.id;
    a.style.background = on ? 'var(--bg-hover)' : '';
    a.style.color = on ? 'var(--text)' : '';
    if (on) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
}

if (sections.length) {
  window.addEventListener('scroll', paint, { passive: true });
  paint();
  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 60);
  }
}
