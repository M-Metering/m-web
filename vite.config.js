import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
})