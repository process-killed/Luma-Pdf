# JavaScript API

Two integration paths: raw `postMessage`, or the helper in `js/embed/api.js`.

## postMessage

Accepted shapes:

```js
// Preferred
iframe.contentWindow.postMessage(
  { type: 'luma', command: 'setPage', payload: { page: 4 } },
  'https://your-domain.example'
);

// Shorthand
iframe.contentWindow.postMessage({ type: 'luma:setPage', page: 4 }, 'https://your-domain.example');
```

Responses:

```js
{ type: 'luma:response', command: 'setPage', ok: true, result: { page: 4 } }
{ type: 'luma:response', command: 'setZoom', ok: false, error: 'Unknown zoom' }
```

### Commands

| Command | Payload | Result |
| --- | --- | --- |
| `setPage` | `{ page }` | `{ page }` |
| `setZoom` | `{ zoom }` | `{ zoom }` (percent) |
| `nextPage` | — | `{ page }` |
| `previousPage` | — | `{ page }` |
| `searchText` | `{ text }` | `{ term }` + `luma:searchCompleted` |
| `print` | — | `{ ok: true }` |
| `download` | — | `{ ok: true }` |
| `toggleSidebar` | — | `{ sidebar }` |
| `toggleFullscreen` | — | `{ fullscreen }` |
| `getDocumentInfo` | — | `{ pages, page, title, author, subject, creator, producer, file }` |
| `setTheme` | `{ theme }` | `{ theme }` |
| `open` | `{ url }` | Loads another PDF |

### Events

`luma:ready`, `luma:loaded`, `luma:error`, `luma:pageChanged`, `luma:zoomChanged`, `luma:searchCompleted`, `luma:fullscreenChanged`, `luma:annotationChanged`, `luma:documentInfo`.

Each arrives as `{ type, detail, version }`.

### Origin policy

* Commands are accepted only from `window.parent` or `window.opener`.
* Same-origin parents are always allowed.
* Additional origins must be declared with the `origin` parameter (comma separated, exact match).
* Payloads are reduced to strings, numbers and booleans; nothing is evaluated.
* Unknown command names are dropped silently.

## Helper (`js/embed/api.js`)

```html
<iframe id="pdf" src="/embed.html?file=/report.pdf" width="100%" height="700" style="border:0"></iframe>
<script type="module">
  import { createLumaBridge } from './js/embed/api.js';
  const luma = createLumaBridge(document.getElementById('pdf'), { origin: location.origin });

  luma.on('luma:pageChanged', ({ page }) => console.log('page', page));
  luma.on('luma:loaded', async () => {
    console.log((await luma.getDocumentInfo()).pages, 'pages');
    luma.setPage(4);
  });
</script>
```

Methods: `open(url)`, `setPage(n)`, `setZoom(z)`, `nextPage()`, `previousPage()`, `search(text)`, `print()`, `download()`, `toggleSidebar()`, `toggleFullscreen()`, `setTheme(theme)`, `getDocumentInfo()`, `on(type, fn)`, `off(type, fn)`, `destroy()`.

Every method returns a promise that resolves with the viewer's result, or rejects after the configured timeout (default 8 s).
