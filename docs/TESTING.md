# Testing

Manual test plan. Run it against a served copy (`python3 -m http.server` is enough) — opening the files with `file://` disables service workers and breaks module loading in some browsers.

## Viewer

1. Open a local PDF → first page renders, page count correct.
2. Paste a same-origin URL → loads.
3. Paste a URL from a host without CORS → the viewer explains CORS and offers retry.
4. Search a word that appears on several pages → count, highlight, Enter / Shift+Enter navigation.
5. Zoom: fit width, fit page, actual, 400%, then wheel zoom.
6. Switch layout: continuous → single → horizontal → spread → book; toggle direction.
7. Rotate the view; confirm text selection still works.
8. Highlight text, draw, add a rectangle and a note, undo, redo.
9. Export annotated copy → reopen it and confirm the marks are in the PDF.
10. Export page range → correct pages only.
11. Print → print preview shows every page as an image.

## Tools (33)

Run each tool on a real document and open the output:

`merge`, `split` (ranges / each / chunks), `extract`, `delete-pages`, `reorder`, `rotate`, `crop`, `resize`, `duplicate-pages`, `pdf-to-jpg`, `pdf-to-png`, `pdf-to-webp`, `pdf-to-print-images`, `images-to-pdf`, `pdf-to-text`, `text-to-pdf`, `compress`, `optimise images`, `reduce size`, `optimise structure`, `strip-metadata`, `metadata`, `page-count`, `file-info`, `dimensions`, `version`, `password-check`, `outline`, `text-extraction`, `screenshot`, `watermark`, `page-numbers`, `signature`.

Also verify the failure paths: a non-PDF file, an encrypted PDF, an empty page range.

## Editor

1. Add a PDF → page grid appears.
2. Select with click, Shift-click, Ctrl-click; drag to reorder.
3. Rotate, duplicate, delete, "keep only selected".
4. Add text, image, watermark and page numbers; remove one overlay.
5. Export → download the file and open it: page order, rotations and overlays applied.
6. Insert a second PDF → pages appended in order.

## Embed

1. `embed.html?file=…` loads with defaults.
2. `theme=dark&background=dark&sidebar=1&page=3` applies.
3. `readonly=1` hides download, print and annotation controls.
4. From a parent page: `setPage`, `nextPage`, `setZoom`, `searchText`, `getDocumentInfo` all respond.
5. A message from a disallowed origin is ignored.

## PWA

1. Serve over HTTPS (or localhost), install from the browser.
2. Go offline → the shell still loads; saved documents open.
3. Save a document, reload while offline, confirm it opens.
4. Publish a new build → "Update available" toast appears.

## Responsive

320, 360, 390, 430, 768, 1024, 1366, 1920 px: no horizontal scrolling, toolbars reachable, bottom bar on phones, sidebar becomes an overlay.

## Accessibility

Keyboard-only pass: Tab reaches every control, `Escape` closes dialogs and search, focus is visible, dialogs trap focus, `aria-live` announces toasts and page changes.
