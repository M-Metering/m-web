import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Environment files live in src/ (src/.env, template src/.env.example — the
// location README and .gitignore already used). Without this, Vite read only
// the project root, so a VITE_API_BASE_URL set in src/.env was silently
// ignored and the build fell back to the production API. Variables set by the
// hosting platform's own environment are read either way.
const ENV_DIR = 'src'
const DEFAULT_API_ORIGIN = 'https://api.memetering.com'

// The Content-Security-Policy, shipped INSIDE the built index.html as a
// <meta http-equiv> tag (2026-10-01), so it applies on whatever host serves
// the build. It used to exist only as a vercel.json response header, which no
// other host reads. The API origin comes from the same VITE_API_BASE_URL the
// app calls, so the two can never disagree.
//
// Uploaded photos: their url is the API's /files/{token}, which redirects (302)
// to a short-lived signed URL on the storage bucket, and the browser checks the
// redirect TARGET against the CSP too. The bucket's host is not documented and
// can change with the storage provider, so img-src allows any https: image
// (an image cannot run code). The Completed Installations export also FETCHES
// photos to embed them, which needs the bucket in connect-src: set
// VITE_FILE_STORAGE_ORIGIN to it. Without it the workbook keeps each picture's
// link and only skips the embedded preview (utils/photoEmbed.js).
// blob: in img-src is for decoding a photo before compressing it.
//
// A <meta> CSP cannot carry frame-ancestors, X-Frame-Options, HSTS or the
// other response-only headers — DEPLOYMENT.md lists what the host must set.
// Build-only: the dev server's React refresh preamble is an inline script.
function cspMetaTag(apiOrigin, storageOrigin) {
  const connect = ["'self'", apiOrigin, storageOrigin].filter(Boolean).join(' ')
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
  // Inserted right after <meta charset>: the charset must stay first in
  // <head>, and the policy must precede every script it governs.
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
  return {
    name: 'csp-meta-tag',
    apply: 'build',
    transformIndexHtml(html) {
      const charset = /<meta charset="UTF-8"\s*\/?>/i
      if (!charset.test(html)) throw new Error('csp-meta-tag: <meta charset="UTF-8"> not found in index.html')
      return html.replace(charset, (m) => `${m}\n    ${tag}`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, 'VITE_')
  const originOf = (value, fallback = null) => {
    try {
      return value ? new URL(value).origin : fallback
    } catch {
      return fallback // api.config.js falls back to the default for an invalid value too
    }
  }
  const apiOrigin = originOf(env.VITE_API_BASE_URL, DEFAULT_API_ORIGIN)
  const storageOrigin = originOf(env.VITE_FILE_STORAGE_ORIGIN)

  return {
    envDir: ENV_DIR,
    plugins: [
      react(),
      cspMetaTag(apiOrigin, storageOrigin),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'brand-logo.png'],
        manifest: {
          name: 'ME Metering Integration',
          short_name: 'ME Metering',
          description: 'ME Metering meter installation, payment, and management system',
          theme_color: '#5c4104',
          background_color: '#fefbea',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          // ExcelJS (~940 kB) is only needed when someone exports, which needs
          // the network anyway — don't make every install download it up front.
          globIgnores: ['**/exceljs*.js'],
          runtimeCaching: [
            {
              // Never cache API responses — this app surfaces live payment,
              // installation, and inventory state, and Workbox's default
              // cache-then-network behavior for same-shape requests could
              // otherwise resurface stale financial/installation data while
              // offline or on a flaky connection. The app's existing error
              // handling (ERROR_TYPES.NETWORK) already reports connectivity
              // failures cleanly, so no fallback caching is needed here.
              urlPattern: ({ url }) => url.pathname.includes('/api/'),
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
    ],
    server: {
      port: 5173,
      open: true
    }
  }
})
