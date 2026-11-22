# Luma PDF

A universal PDF workspace that runs entirely in the browser: read, search, annotate, edit, convert, and embed PDFs without uploading anything.

**v1.0.0** · static files · no build step · no backend · no account

---

## What it does

| Surface | File | What you get |
| --- | --- | --- |
| Viewer | `viewer.html` | Continuous / single / horizontal / spread / book layouts, RTL, presentation and distraction-free modes, 25–500% zoom, whole-document search over the real text layer, thumbnails, outline, bookmarks, annotations (highlight, ink, shapes, notes, signatures) and export into a new PDF |
| Tools | `tools.html` | 33 utilities: merge, split, extract, delete, reorder, rotate, crop, resize, duplicate, PDF↔JPG/PNG/WebP, images→PDF, PDF↔text, print images, compress, optimise, reduce, strip metadata, metadata, page count, file info, dimensions, version, password check, outline, text extraction, screenshot, watermark, page numbers, signature |
| Editor | `editor.html` | Page organiser (multi-select, drag reorder, rotate, duplicate, delete, extract) plus export-time text, image, watermark and page-number overlays |
| Embed | `embed.html` | Chrome-light viewer configured by 26 URL parameters, with a `postMessage` API and strict origin checks |
| Generator | `embed-generator.html` | Live preview, presets, generated URL and iframe snippets |
| Library | `library.html` | Local-only document library with reading positions, favourites and storage controls |
| Docs | `docs.html` | Embedding, API, deployment, CORS, security, performance, testing |

Everything is a real implementation: no placeholder buttons, and features that cannot work in a browser say so plainly.

## Quick start

```bash
# any static server works
python3 -m http.server 8080
# then open http://localhost:8080/
```

Open a PDF with the drop zone, or go straight to a file:

```
viewer.html?file=/docs/report.pdf
viewer.html?doc=<library-id>
embed.html?file=https://example.com/report.pdf&theme=dark&page=3
```

Deploy by copying the folder to Cloudflare Pages, Netlify, Vercel, GitHub Pages, Firebase Hosting, Apache, Nginx or any static host. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Technology

* **HTML5 / CSS3 / vanilla ES modules** — no framework, no runtime.
* **[PDF.js](https://mozilla.github.io/pdf.js/) 3.11.174** (Apache-2.0) — rendering, text layer, search, outline, metadata.
* **[pdf-lib](https://pdf-lib.js.org/) 1.17.1** (MIT) — page copying, rotation, watermarks, annotation export.
* **IndexedDB** — local documents, annotations, bookmarks, reading positions.
* **Service worker + manifest** — installable PWA with an offline shell.

Both libraries are vendored in `vendor/`, pinned, and loaded from the same origin: the app works offline and never calls a CDN.

## Project structure

```
luma-pdf/
├── index.html                 homepage
├── viewer.html                reader + annotations
├── tools.html                 33 PDF tools
├── editor.html                page organiser + overlays
├── embed.html                 embeddable viewer
├── embed-generator.html       embed builder
├── docs.html                  developer documentation
├── library.html               local library
├── settings.html              preferences
├── about.html                 privacy + licences
├── offline.html               service-worker fallback
├── manifest.json  sw.js  favicon.svg
├── assets/                    icons, images, fonts
├── css/                       tokens, reset, themes, main, layout, homepage,
│                              viewer, toolbar, sidebar, annotations, editor,
│                              tools, embed, animations, responsive
├── js/
│   ├── app.js  shell.js  config.js  state.js  theme.js
│   ├── pages/                 one module per page
│   ├── viewer/                pdf-engine, renderer, viewer, search,
│   │                          thumbnails, annotations, toolbar, keyboard, navigation
│   ├── editor/                document-editor, page-editor, export,
│   │                          text-editor, image-editor
│   ├── tools/                 catalog, pdf-utils, merge, split, convert,
│   │                          compress, metadata, watermark
│   ├── embed/                 config, messaging, api
│   ├── storage/               database, library, history, cache
│   ├── pwa/                   install, updates
│   ├── performance/           device-detection, adaptive-rendering, memory-manager
│   ├── ui/                    icons, ui primitives
│   └── utils/                 dom, files, urls, security, browser, accessibility, zip
├── vendor/                    pdfjs/, pdf-lib/ (pinned)
├── docs/                      README, EMBEDDING, API, DEPLOYMENT, SECURITY, CORS, PERFORMANCE, TESTING
└── deployment/                netlify.toml, vercel.json, _headers, apache.conf, nginx.conf
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` `→` `↑` `↓`, `PageUp`/`PageDown` | Navigate pages |
| `Home` / `End` | First / last page |
| `Ctrl/Cmd + F` | Search |
| `Ctrl/Cmd + P` | Print |
| `Ctrl/Cmd + S` | Save / download |
| `Ctrl/Cmd + +` / `-` | Zoom in / out |
| `Ctrl/Cmd + 0` | Fit width |
| `Ctrl/Cmd + B` | Toggle sidebar |
| `F` | Fullscreen |
| `R` | Rotate view |
| `Z` | Distraction-free mode |
| `Escape` | Close dialogs, search or fullscreen |

Shortcuts are ignored while typing in a field and can be disabled in Settings.

## Privacy

* No uploads: files are decoded in memory by PDF.js.
* No accounts, no analytics, no telemetry, no third-party requests.
* Saved documents live in this browser's IndexedDB and can be deleted from the Library or Settings.
* PDFs never execute their embedded JavaScript (`isEvalSupported: false`).
* Remote PDFs are fetched directly from their host — Luma PDF ships no CORS proxy.

## Known limitations

* Encrypted PDFs can be read with a password, but the editing tools refuse them.
* Re-saving a signed PDF invalidates its signature.
* Compression re-renders pages as images, so text stops being selectable.
* OCR is not bundled; scanned pages without a text layer are reported honestly.
* Very large documents are bounded by browser memory, not by the app.
* Signature placement draws an image — it is not a cryptographic signature.

## Licence and credits

Application code © the Luma PDF project. PDF.js is Apache-2.0, pdf-lib is MIT; both are included unmodified in `vendor/`. The interface, design system and all application modules are original work.
