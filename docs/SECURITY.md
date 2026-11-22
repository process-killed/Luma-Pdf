# Security

## Model

Everything runs in the user's tab. There is no server, no account and no database, so the attack surface is the browser APIs the app uses: file reading, PDF parsing, rendering, local storage and postMessage.

## What is enforced

| Area | Measure |
| --- | --- |
| PDF parsing | PDF.js with `isEvalSupported: false`; PDF-embedded JavaScript is never executed |
| Remote documents | Loaded with the browser's own origin rules; no proxy, no server-side fetch |
| postMessage | Only `window.parent`/`window.opener`, only known commands, only allowed origins, primitives only |
| URLs | Validated against an http(s) allow-list before use; `javascript:` and `data:` documents rejected |
| DOM injection | User text goes through `textContent` or an escape function; no dynamic `innerHTML` with untrusted values |
| Downloads | Object URLs revoked after use; filenames sanitised |
| Storage | IndexedDB only, scoped to this origin, deletable from Settings |
| Third parties | None. No analytics, no CDN, no fonts fetched remotely |

## Content Security Policy

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  connect-src 'self' https: blob:;
  frame-src 'self' https:;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'none';
```

`style-src 'unsafe-inline'` is required because the text layer and annotation layer position elements with inline styles. `connect-src https:` is required to open PDFs from other origins — narrow it to your own domains if you only serve local files.

If you embed third-party PDFs, keep `frame-src` restricted to your own origin.

## Honest limits

* **No DRM.** Hiding the download button (`download=0`) is a UI choice. Anyone who can read a PDF in a browser can save it. Use authenticated, server-side delivery for genuinely restricted documents.
* **No digital signatures.** The signature tool draws an image. It carries no certificate and proves nothing cryptographically.
* **Encrypted PDFs** can be opened with a password but are refused by the editing tools.
* **Local storage is per browser.** "Deleting" a document removes it from IndexedDB; browser-level backups or OS snapshots are outside the app's control.

## Reporting

This is a self-hosted project: audit the code you deploy. The security-relevant modules are `js/utils/security.js`, `js/embed/messaging.js` and `js/viewer/annotations.js` (export path).
