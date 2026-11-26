/**
 * Inline every stylesheet into each HTML page.
 *
 * The site has no build step, but eight render-blocking <link> tags cost a full round
 * trip each on a slow connection — which is exactly what LCP measures. This script
 * replaces them with one <style> block (the same rules, in the same order) so the first
 * paint never waits for CSS.
 *
 * Run after editing any file in css/:   node scripts/inline-critical.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const START_PREFIX = '<!-- critical-css:start';
const END = '<!-- critical-css:end -->';

const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
let count = 0;

for (const page of pages) {
  const file = join(root, page);
  let html = readFileSync(file, 'utf8');

  // Which stylesheets does this page need? Either its <link> tags (first run) or the
  // list recorded in the previous generated block (later runs).
  const linkMatches = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"?]+)(?:\?[^"]*)?"\s*>/g)];
  let sheets = linkMatches.map((m) => m[1]);

  const existing = html.indexOf(START_PREFIX);
  if (existing !== -1) {
    const endIdx = html.indexOf(END, existing);
    if (endIdx !== -1) {
      const comment = html.slice(existing, html.indexOf('-->', existing));
      if (!sheets.length) {
        const recorded = comment.match(/css:([^>]*?)-->/);
        if (recorded) {
          sheets = recorded[1].split(',').map((f) => f.trim()).filter((f) => f.startsWith('css/'));
        }
      }
      if (!sheets.length) {
        // Older blocks had no list: recover it from the per-file comments inside.
        const oldBlock = html.slice(existing, endIdx);
        sheets = [...oldBlock.matchAll(/\/\* (css\/[\w\-./]+\.css) \*\//g)].map((m) => m[1]);
      }
      html = html.slice(0, existing) + html.slice(endIdx + END.length);
    }
  }
  if (!sheets.length) continue;

  const css = sheets.map((file) => `/* ${file} */\n${readFileSync(join(root, file), 'utf8')}`).join('\n');
  const start = `<!-- critical-css:start css:${sheets.join(',')} -->`;
  const block = `${start}\n<style>\n${css}\n</style>\n${END}`;

  if (linkMatches.length) {
    html = html.replace(linkMatches[0][0], block);
    for (const m of linkMatches.slice(1)) html = html.replace(m[0], '');
  } else {
    // Re-run: put the refreshed block where the old one was (before </head>).
    html = html.replace('</head>', block + '\n</head>');
  }
  html = html.replace(/\n{3,}/g, '\n\n');

  writeFileSync(file, html);
  count++;
}

console.log(`Inlined stylesheets into ${count} page(s).`);
