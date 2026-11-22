# Performance

Target hardware: Android phones with 3 GB RAM, older laptops, budget Chromebooks, slow connections.

## Profiles

| Profile | Canvas budget | DPR cap | Concurrent renders | Cached pages | Thumbnail width |
| --- | --- | --- | --- | --- | --- |
| Eco | 1.6 MP | 1.0 | 1 | 2 | 110 px |
| Balanced | 4.2 MP | 1.5 | 2 | 4 | 150 px |
| Performance | 12 MP | 2.0 | 3 | 8 | 190 px |

Selection is automatic (`js/performance/device-detection.js`): `deviceMemory ≤ 3`, `hardwareConcurrency ≤ 4`, a slow connection, data-saver mode or a very high pixel ratio selects Eco. Users can override it in Settings.

## Techniques in the build

* **Virtualised pages** — an `IntersectionObserver` renders only pages near the viewport, with a `rootMargin` of 420 px.
* **Deferred page measurement** — the first page is measured before paint; the remaining page sizes are measured in 16-page chunks afterwards. A 500-page file opens as fast as a 5-page one.
* **Pixel budget** — `computeRenderPlan()` caps `width × height × dpr²` per page and lowers the device pixel ratio when needed.
* **Bounded caches** — rendered pages are tracked in an LRU-ish list; off-screen canvases are zeroed (`canvas.width = 0`) to release GPU/CPU memory.
* **Cancellable renders** — zoom, layout changes and page release cancel in-flight render tasks.
* **Thumbnail reuse** — thumbnails are drawn from the already-rendered page bitmap when available, otherwise rendered with the `print` intent so they never cancel a live viewer render.
* **Idle scheduling** — thumbnail work yields through `requestIdleCallback`, so the event loop stays responsive.
* **No layout-thrashing animations** — only `transform` and `opacity` animate; `prefers-reduced-motion` and the Eco profile disable them.

## Large documents

* Above 800 pages the viewer keeps one page size for all pages (no per-page measurement) to avoid thousands of worker round-trips.
* Above 1200 pages the interface warns that rendering may be slow.
* The tools process pages sequentially and yield between pages, so memory stays flat; extremely large files are limited by browser memory, not by the app.

## Measuring

Open DevTools → Performance, record a scroll through a long document, and look for:

* no long tasks above ~50 ms while scrolling,
* canvas memory released after scrolling away,
* one or two worker renders in flight, never a growing queue.

The build stamp in the footer identifies the running version.
