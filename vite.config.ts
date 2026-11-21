import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
const buildId = `${pkg.version}${sha ? '+' + sha : ''}`;

export default defineConfig({
  // GitHub Pages serves the app from /abb-580-auditor/; local builds stay relative.
  base: process.env.GITHUB_ACTIONS ? '/abb-580-auditor/' : './',
  define: {
    __APP_VERSION__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ABB 580 Field Auditor',
        short_name: 'ABB 580 Auditor',
        description: 'Offline field auditor for ABB ACH580 / ACQ580 / ACS580 drive parameter backups.',
        theme_color: '#111111',
        background_color: '#f4f4f1',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  worker: { format: 'es' },
});
