# Deployment

The app is a static single-page application. `npm run build` writes everything to `dist/`; any
static web server can serve it. It is not tied to a hosting provider: the Vercel test deployment
and its `vercel.json` were retired on 2026-10-01, and that file's settings are listed below.

## Build

```bash
npm ci
npm run lint && npm test
npm run build        # output: dist/
```

### Environment

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | API origin, without `/api/v1` | `https://api.memetering.com` |
| `VITE_FILE_STORAGE_ORIGIN` | Optional. Origin of the storage bucket that photo links redirect to (`GET /files/{token}` → 302). Lets the Completed Installations export embed photos; without it the export still carries each photo's link. | unset |

Set them in the build environment, or in `src/.env` (template: `src/.env.example`; Vite reads env files
from `src/`). They are read **at build time** and baked into the bundle, so changing them needs a rebuild.
The same values set the API (and storage) hosts in the Content-Security-Policy (see below). There are no secrets in
this app: no API keys or credentials go in the build.

API documentation: <https://api.memetering.com/api-docs>.

## What the web server must do

### 1. Serve `index.html` for every unknown path (required)

Routes such as `/installations`, `/my-jobs` or `/installations/0100` exist only in the browser. On
a page refresh or an opened link the server must return `dist/index.html` (status 200) for any
path that isn't a real file. Without this, every page except `/` returns 404 on refresh.

Real files (`/assets/*`, `/sw.js`, `/manifest.webmanifest`, icons) must still be served as files.

### 2. Response headers (required for security)

The Content-Security-Policy is **already inside the built `index.html`** as a `<meta>` tag, generated
by `vite.config.js`, so it needs no server configuration. These headers can't be set from a page
and must come from the server, on every response:

| Header | Value |
|---|---|
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `frame-ancestors 'none'` (the one directive a `<meta>` CSP can't carry; optional alongside `X-Frame-Options`) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self), payment=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (HTTPS only) |

`camera=()` does not affect "Take photo": the photo field uses a file input, which opens the
phone's own camera app and needs no camera permission. `geolocation=(self)` is required for
"Use my location" on Report Installation.

### 3. Caching (recommended)

| Path | `Cache-Control` |
|---|---|
| `/assets/*` (file names carry a content hash) | `public, max-age=31536000, immutable` |
| `/index.html`, `/sw.js`, `/registerSW.js`, `/manifest.webmanifest` | `no-cache` |

`index.html` and the service worker must **not** be cached long. Otherwise installed PWAs keep
running an old build after a deploy.

### 4. HTTPS

Required: the service worker, "Use my location" (geolocation) and camera capture all need a secure
origin.

## After deploying

1. Open the site and confirm the new build is live. A hard refresh may be needed once while the
   service worker updates.
2. Refresh on a deep link such as `/installations`. It must load, not 404.
3. As an installer: Report Installation → take a photo and choose one from the gallery. Both must
   upload and show "Photo attached".
