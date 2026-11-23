# OCR

Luma PDF can recognise text on scanned pages and add an **invisible text layer**, so a
scanned document becomes searchable and copyable while looking exactly the same.

## How it works

1. Each selected page is rendered to a canvas at 150–300 DPI (in the tab).
2. Tesseract recognises words and their boxes.
3. The words are drawn back onto the **original page** with `opacity: 0`, at the exact
   positions found by the engine.

Because the page itself is untouched, you keep the original image quality, file size and
layout. The invisible text is what search engines and the search box in Luma PDF use.

## The engine

OCR is the only feature that downloads code at runtime: Tesseract.js plus the English
language model, about 7 MB on first use. The PDF never leaves the browser — only the
engine is fetched.

| Asset | Default source |
| --- | --- |
| `tesseract.min.js` | `cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/` |
| `worker.min.js` | same package |
| `tesseract-core-simd-lstm.wasm.js` | `cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/` |
| `eng.traineddata.gz` | `cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/` |

## Making OCR work offline

Download the four files above into `vendor/tesseract/` and point the engine at them:

```js
// js/tools/ocr.js
export const OCR_ENGINE = {
  script: 'vendor/tesseract/tesseract.min.js',
  worker: 'vendor/tesseract/worker.min.js',
  core: 'vendor/tesseract/',
  lang: 'vendor/tesseract/lang/',
  langCode: 'eng'
};
```

`core` must contain `tesseract-core-simd-lstm.wasm.js` (and `tesseract-core-lstm.wasm.js`
for browsers without SIMD). `lang` must contain `eng.traineddata.gz`. Add the folder to
the service-worker precache list in `sw.js` if you want it cached.

## Other languages

Drop `deu.traineddata.gz`, `hin.traineddata.gz`, `tam.traineddata.gz`… into the language
folder and change `langCode`. Tesseract language files live at
`github.com/tesseract-ocr/tessdata_best` (or `tessdata_fast` for speed).

## Limits

* English is bundled; other languages need the file above.
* Handwriting is recognised poorly by Tesseract — it is designed for print.
* Very large pages are downscaled to keep memory flat, which can hurt small print.
* OCR is not applied automatically: it costs time and battery, so it runs when you ask.
