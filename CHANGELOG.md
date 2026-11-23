# Changelog

## v1.0.1 — zoom, pan and annotation performance

Fixes the four problems reported against v1.0.0: pages could not be dragged or swiped
after zooming, annotations felt laggy, the viewer stuttered while scrolling, and zooming
flashed blank pages.

### Fixed

| Problem | Cause | Fix |
| --- | --- | --- |
| Could not drag or swipe the page after zooming | Pages were centred with `align-items: center`; once a page was wider than the viewport its left side overflowed into unreachable space (measured: 344 px unreachable at 300% zoom) | Pages now use `align-items: safe center` and the stack is `width: max-content`, so a zoomed page scrolls to both edges |
| No way to drag the document | Panning was never implemented (middle-drag moved 0 px) | Hand tool in the toolbar, middle-button drag, `Space` + drag, and native touch panning; double-click zooms |
| Zoom flashed blank pages | Zooming released every canvas before re-rendering (3 of 8 sampled frames had a blank page) | Zooming stretches the existing bitmap and re-renders in place — 0 blank frames |
| Zoom ignored the cursor | Scroll offsets were scaled naively, and clamped by the old scroll area | Zoom is anchored to the page point under the pointer (measured drift: 0 px) |
| Scrolling stuttered | Every scroll tick read the geometry of every page (234 layout reads for 15 ticks) | Page geometry is cached per layout change — **0** layout reads while scrolling; scroll handler costs 0.2 ms |
| Annotation drawing was choppy | Each pointermove destroyed and rebuilt the draft SVG (63 nodes added per stroke) | One draft element per gesture, updated in place (2 nodes per stroke), rAF-throttled |
| Annotations rebuilt on every zoom/selection | Full re-render on zoom, on select, on page change | Annotation layers live in page coordinates and are scaled by one CSS transform; selection toggles an attribute |
| Annotation persistence lag | Full JSON write on every change | Debounced 500 ms; the sidebar list is throttled |
| Highlights could be invisible | A flat drag produced a zero-height rectangle | Highlights, underlines and strike-throughs snap to the text lines under the drag |
| Large documents opened slowly | Every page got a full DOM subtree up front | Off-screen pages are same-size placeholders; only pages near the viewport are mounted (120-page doc: 26 mounted, 3 rendered) |
| Eco profile on decent hardware | 4 cores or 3 GB RAM counted as "weak" | Only ≤2 cores, ≤2 GB, 2G or data-saver select Eco; Eco itself is less restrictive (2 concurrent renders, 2.2 MP budget) |

### Added

* Hand tool (`H`), `Space` + drag panning, middle-button drag.
* Pinch-to-zoom on touch, `Ctrl`/`Cmd` + wheel zoom, double-click zoom.
* Annotation keyboard shortcuts (`V S U K P M E T N B O A L G I`), duplicate (`Ctrl/Cmd + D`), delete (`Del`), opacity slider.
* Smoothed ink strokes (quadratic curves) instead of polylines.
* Text-aware highlight/underline/strike that follows real text lines.
* Selectable text is available immediately after the first paint, not only after a zoom.

### Changed

* `sw.js` cache version and every `?v=` asset query bumped to `1.0.1` so browsers pick up the new files.
* Performance table in `docs.html` reflects the new profile limits.

### Upgrading

Copy the files in this archive over your existing deployment, keeping the folder structure.
There are no new files to configure and no build step. Reload twice (once to install the new
service worker, once to activate it) and check the footer reads `v1.0.1 · build 2026-11-22 22:45 IST`.
