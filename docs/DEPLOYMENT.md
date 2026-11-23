# Deployment

Luma PDF is static. There is no build step, no runtime, no environment variables.

```
upload the folder → open index.html → done
```

## Host requirements

| Requirement | Why |
| --- | --- |
| `.js` served as `text/javascript` | ES modules fail with the wrong MIME type |
| `.wasm` served as `application/wasm` | qpdf (password tools) loads faster and without a warning |
| `vendor/pdfjs/pdf.worker.min.js` reachable | PDF.js worker; path is resolved relative to `js/viewer/pdf-engine.js` |
| `sw.js` at the site root | Service worker scope must cover the pages |
| HTTPS | Service worker, PWA install, clipboard |

## Cloudflare Pages

1. Create a Pages project and upload the folder (direct upload works).
2. Framework preset: **None**. Build command: empty. Output directory: `/`.
3. `_headers` in `deployment/` can be copied to the root for security headers.

Cloudflare Workers with static assets also works: add the folder as `assets.directory` and set `assets.not_found_handling` to `404-page`.

## Netlify

Copy `deployment/netlify.toml` to the repository root and connect the repo, or drag the folder into the Netlify UI.

## Vercel

Copy `deployment/vercel.json` to the root. `cleanUrls: true` means `/viewer` also works; the app never depends on it.

## GitHub Pages

1. Push the folder to a repository.
2. Settings → Pages → deploy from branch, root.
3. If it is a project site (`/repo-name/`), every path in the app is relative, so it works without changes.

## Firebase Hosting

```json
{
  "hosting": {
    "public": ".",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "headers": [
      { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
    ]
  }
}
```

## Apache / Nginx

Use `deployment/apache.conf` or `deployment/nginx.conf`. Both add the correct MIME types, caching for `vendor/`, and `no-cache` for `sw.js`.

## Updating a deployed build

1. Change the files.
2. Bump `APP.version` in `js/config.js`, `ASSET_V`, the `?v=` query on the HTML asset links, and the `VERSION` constant in `sw.js`.
3. Redeploy.

The service worker serves the old shell until the new one activates; the app shows an "Update available" toast and reloads on request. The build stamp in the footer (`v1.0.0 · build …`) tells you which build a user is actually running.

## Embedding on another site

Deploy Luma PDF once, then point iframes at `https://your-deployment/embed.html?file=…`. The PDF itself can live anywhere that allows CORS.
