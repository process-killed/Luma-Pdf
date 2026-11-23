# Changelog

## v1.2.0 — fast open, smooth scrolling, real mobile layout

Everything here is about the two things you reported: a long wait before the first page,
and stutter while scrolling fast on a phone.

Measured on the same machine with the CPU throttled 4× (a stand-in for a low-end phone),
120-page document:

| | v1.1.0 | v1.2.0 |
| --- | --- | --- |
| First page on screen | 14.1 s | **11.7 s** |
| First page, 12-page document | 17.9 s | **15.7 s** |
| Scroll frame, median | 341 ms | **203 ms** |
| Scroll frame, 90th percentile | 663 ms | **254 ms** |
| Scroll frame, worst | 717 ms | **368 ms** |
| Bytes parsed before the first page | 525 KB more (pdf-lib) | pdf-lib not loaded |

### Opening a document

* **pdf-lib is no longer loaded to view a PDF.** It is half a megabyte and only needed for
  editing, so it is fetched the first time you fill a form or export — on the viewer, the
  tools and the editor alike.
* **The page-size table is built lazily.** Page 1 is measured before the first paint; the
  rest are measured as they approach the viewport, so a 500-page file costs one worker
  call instead of five hundred.
* **A cheap preview paints first.** The visible page is rendered at a fraction of the
  device pixels (a few milliseconds), then sharpened; you can read before it is perfect.
* **The PDF is fetched by us, not by PDF.js**, so the download starts while the worker
  boots instead of after it, and progress works everywhere.
* **The worker is booted early and reused**, so no second worker is started per document.
* **Metadata, thumbnails, the outline, bookmarks and form detection are deferred** until
  after the first page — and form detection now sniffs for `/AcroForm` in the raw bytes
  before parsing anything with pdf-lib.
* **Annotation and signature modules load on first use**, not on every open.
* **The service worker installs a ~150 KB shell** and warms the engine bundles in the
  background; registration waits for the browser to be idle.
* **Critical modules are preloaded** with `modulepreload`, and the document URL is
  prefetched from the query string.

### Scrolling

* **Preview-quality rendering while a scroll is in flight**: only the page under the
  reader is rendered, at ~25 % of the pixels, and the sharp pass follows when scrolling
  stops. Pages that fly past get no render at all.
* **Renders for pages that left the viewport are skipped** before they start.
* **Phones cap the pixel budget** (1.5× DPR, 3 MP per page) — invisible at 400 ppi, and it
  removes the single most expensive operation on a mid-range phone.

### Mobile layout fixes

* **The page was clipped and off-centre on every phone.** Unmounted pages kept their
  unscaled size, so the stack was measured too wide; placeholders now track the zoom.
* **Toolbar no longer overflows.** A phone shows page navigation, search, zoom and the ⋮
  menu; everything else moved into that menu.
* **The annotation palette is a bottom sheet** with 44 px targets, four tidy rows and a
  grabber, instead of a strip of tiny icons that scrolled off screen.
* **Dialogs are bottom sheets** on small screens, scroll internally and keep their buttons
  reachable.
* **No page can be wider than the screen**: the documentation grid, its tables and the
  embed generator no longer push a 617 px layout onto a 360 px screen.
* **Safe-area insets** for notched phones, 44 px bottom-bar targets, and 16 px form inputs
  so iOS stops zooming the page when a field is focused.

### Diagnostics

* `performance` marks (`luma:module`, `luma:doc-request`, `luma:pdf-parsed`,
  `luma:first-page`…) are recorded on every open and visible in DevTools — the numbers
  above come from them.


## v1.1.0 — forms, OCR, passwords and page imposition

A feature release built on four new engines, all running in the tab.

### New in the viewer

* **Fill PDF forms.** AcroForm fields (text, checkbox, radio, dropdown, list) are detected
  and rendered as real inputs on top of the page, in page coordinates, so they stay
  aligned at any zoom. Save writes the values into a copy, with an option to flatten them
  so every reader shows them.
* **Signature library.** Draw with pressure support, type a signature in three styles, or
  upload a photo — the ink is trimmed and the white paper turned transparent. Up to eight
  signatures are remembered in this browser.
* **Form status bar** shows how many fields are filled and saves in one click.

### New tools (6, now 39 in total)

| Tool | Engine | What it does |
| --- | --- | --- |
| Protect or unlock PDF | qpdf (WASM, vendored) | AES-256 password with print/copy/edit permissions; unlock with a known password |
| OCR scanned PDF | Tesseract.js | Invisible, searchable text layer, or plain text |
| PDF to Markdown | own layout heuristics | Headings, lists and paragraphs rebuilt from geometry |
| Auto-crop margins | canvas pixel scan | Trims the empty margins of every page |
| N-up sheets | pdf-lib | 2/4/6/9 pages per sheet with gaps and borders |
| List form fields | pdf-lib | Reports every field, its type and value |

### Changed

* Editor: **insert blank pages**, **undo/redo** (Ctrl+Z / Ctrl+Shift+Z) for page edits.
* Deployment files now set the `application/wasm` MIME type (needed by qpdf and by any
  WASM you add later).
* Version stamps and the service-worker cache are bumped to `1.1.0`.

### Notes

* qpdf is vendored in `vendor/qpdf/` (1.4 MB) and works offline.
* The OCR engine is downloaded on first use (~7 MB). `docs/OCR.md` explains how to vendor
  it for fully offline OCR, and how to add more languages.
* Password protection is real encryption, not a UI lock — but there is no recovery if the
  password is lost, and Luma PDF cannot crack a file whose password you do not know.

## v1.0.1 — zoom, pan and annotation performance

Fixed the four problems reported against v1.0.0.

| Problem | Cause | Fix |
| --- | --- | --- |
| Could not drag or swipe after zooming | Pages centred with `align-items: center` left the overflow unreachable (344 px at 300 %) | `align-items: safe center` + `width: max-content` |
| No way to drag the document | Panning was never implemented | Hand tool, middle-drag, Space+drag, native touch panning |
| Zoom flashed blank pages | Zooming released every canvas first | Zoom stretches the existing bitmap (0 blank frames) |
| Zoom ignored the cursor | Scroll offsets scaled naively | Zoom anchored on the page point under the pointer (0 px drift) |
| Scrolling stuttered | Every scroll tick measured every page (234 layout reads / 15 ticks) | Geometry cached per layout change (**0** reads), handler 0.2 ms |
| Annotation drawing choppy | Draft SVG rebuilt per pointermove (63 nodes/stroke) | One draft element, updated in place (2 nodes/stroke) |
| Annotations rebuilt on zoom | Full re-render on zoom/select/page change | Page coordinates + one CSS transform |
| Highlights invisible on a flat drag | Zero-height rectangle | Highlights snap to the text lines under the drag |
| Large documents opened slowly | Full DOM for every page | Off-screen pages are same-size placeholders (120-page doc: 26 mounted, 3 rendered) |

Also added: pinch-zoom, Ctrl+wheel zoom, double-click zoom, annotation keyboard shortcuts,
duplicate/delete, opacity slider, smoothed ink, and immediate text selection on first paint.

## v1.0.0 — first release

Viewer with 5 layouts, search, annotations, 33 tools, editor, embed endpoint + generator,
PWA, local library, documentation.
