# CORS and remote PDFs

## The rule

A browser will not let JavaScript read a file from another origin unless the server says so. PDF.js fetches bytes (and uses HTTP Range requests when the server supports them), so the PDF host must send CORS headers on the PDF response itself — not just on the HTML page.

## Minimum headers

```
Access-Control-Allow-Origin: https://your-site.example
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Range
Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges
Access-Control-Allow-Credentials: false
```

`Access-Control-Allow-Origin: *` also works for public documents (credentials are never sent).

## Symptoms and meaning

| Symptom | Meaning |
| --- | --- |
| "The PDF could not be downloaded … server must send Access-Control-Allow-Origin" | No CORS headers, or the origin does not match |
| `404` / `NOT_PDF` | The URL is wrong, redirected to HTML, or requires login |
| Works in a new tab but not embedded | Same origin rules; the server sends no CORS headers |
| Works for some PDFs, not others | Mixed hosting: the CDN bucket lacks headers |

## Alternatives when you cannot change the headers

1. **Download and open locally** — no network, no CORS.
2. **Self-host a copy** on a domain you control.
3. **Ask the publisher** to add the headers (most CDNs make this a one-line setting).
4. **Same-origin relay you control** — if you already run a server, proxy the PDF through your own domain. This is only safe when the proxy is restricted to the documents you intend to serve.

Luma PDF ships **no public CORS proxy** on purpose. An open proxy lets any site read any PDF through it and defeats the same-origin policy for everyone.

## Range requests

When the host sends `Accept-Ranges: bytes`, PDF.js requests only the parts of the file it needs, so a 200 MB document opens quickly. Without range support the whole file is downloaded before the first page appears — the viewer still works, just later.
