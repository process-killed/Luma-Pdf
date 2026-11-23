# Changelog

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
