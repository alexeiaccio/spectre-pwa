import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'
import oxlint from 'vite-plugin-oxlint'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

/**
 * Build-stamped app version shown in the header. Changes on every deploy
 * (git short hash + local build time) so a stale installed PWA is easy to spot
 * and compare against the version served in a browser tab.
 */
const appVersion = (): string => {
  let hash = 'nogit'
  try {
    hash = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    /* not a git checkout — keep the fallback */
  }
  const pad = (n: number): string => String(n).padStart(2, '0')
  const d = new Date()
  return `g${hash} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        spike: resolve(__dirname, 'spike.html'),
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  plugins: [
    solid(),
    tailwindcss(),
    oxlint({ configFile: '.oxlintrc.json' }),
    VitePWA({
      // `prompt` instead of `autoUpdate`: a new service worker installs and
      // waits, the header shows an "Update available" button, and applying it
      // reloads with the fresh bundle. Without this, an already-open installed
      // PWA silently keeps the old cached build.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'app-icon.svg'],
      manifest: {
        name: 'Spectre Pocket',
        short_name: 'Spectre',
        description:
          'Offline-only password cipher. Remember one secret, math does the rest.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
