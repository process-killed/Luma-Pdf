# Embedding Luma PDF

The embed endpoint is `embed.html`. It renders one PDF, driven entirely by URL parameters, inside an iframe.

## Minimal embed

```html
<iframe
  src="https://your-domain.example/embed.html?file=https://your-domain.example/report.pdf"
  width="100%" height="700" style="border:0"
  loading="lazy" allowfullscreen title="Luma PDF Viewer"
></iframe>
```

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `file` | URL | — | PDF address (absolute, or relative to the embed page). Required. |
| `page` | int | 1 | Page to open. |
| `zoom` | enum/int | `page-width` | `page-width`, `page-fit`, `actual`, or 25–500. |
| `fit` | enum | — | `width`, `page`, `auto`. Alias for zoom fitting. |
| `toolbar` | bool | 1 | Show the control bar. |
| `sidebar` | bool | 0 | Show thumbnails/outline. |
| `navigation` | bool | 1 | Page navigation controls. |
| `search` | bool | 1 | In-document search. |
| `download` | bool | 1 | Download button. |
| `print` | bool | 1 | Print button. |
| `fullscreen` | bool | 1 | Fullscreen button. |
| `controls` | enum | `auto` | `auto`, `always`, `never`. |
| `mobileToolbar` | bool | 1 | Compact bottom bar on phones. |
| `theme` | enum | `auto` | `light`, `dark`, `auto`. |
| `background` | enum | `light` | `light`, `dark`, `sepia`, `slate`, `paper`. |
| `pageMode` | enum | `vertical` | `single`, `vertical`, `horizontal`, `spread`, `book`. |
| `scroll` | enum | — | `vertical` / `horizontal` shortcut. |
| `spread` | bool | 0 | Two-page spread shortcut. |
| `direction` | enum | `ltr` | `ltr` / `rtl`. |
| `language` | string | `en` | Sets `<html lang>` for assistive tech. |
| `annotations` | bool | 0 | Enable annotation tools. |
| `outline` | bool | 0 | Outline tab in the sidebar. |
| `readonly` | bool | 0 | Disables download, print and annotations. |
| `minimal` | bool | 0 | Compact chrome, no sidebar/print. |
| `hideLogo` | bool | 0 | Hide the Luma PDF mark. |
| `watermark` | string | — | Faint overlay text. |
| `origin` | list | same origin | Extra origins allowed to send commands. |

Booleans accept `1/0`, `true/false`, `yes/no`, `on/off`, `show/hide`.

Unknown parameters are ignored. Invalid values fall back to the default and are reported on the console — they never break the frame.

## Presets

The generator ships seven presets: Minimal, Professional, Reading, Dark, Mobile, Documentation, Presentation. They are defined in `js/config.js` (`EMBED_PRESETS`) so you can add your own.

## Recipes

**Blogger / WordPress (Custom HTML block)**

```html
<iframe src="https://your-domain.example/embed.html?file=/files/report.pdf"
        width="100%" height="640" style="border:0"></iframe>
```

**GitHub Pages** — keep the PDF beside the app and use a relative path (`?file=/docs/report.pdf`). Same-origin reads need no CORS.

**Responsive container**

```html
<div style="position:relative;padding-top:min(75vh,720px)">
  <iframe src="/embed.html?file=/report.pdf"
          style="position:absolute;inset:0;width:100%;height:100%;border:0"
          loading="lazy" allowfullscreen title="Report"></iframe>
</div>
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "The PDF could not be loaded" | Missing CORS headers | See [CORS.md](CORS.md) |
| Blank frame | `file` missing or not a permitted URL | Use an absolute http(s) URL |
| Commands ignored | Parent origin not allowed | Add `&origin=https://your-site` or stay same-origin |
| Download button does nothing | `readonly=1` or CORS on fetch | Remove `readonly`, or allow CORS |
