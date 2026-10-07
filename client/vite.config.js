import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// VITE_BASE_PATH lets the demo build be served from a subpath (e.g.
// https://demo.example.com/rackium/) without any code changes — set it to
// e.g. "/rackium/" before `npm run build`. Defaults to root, same as
// before. See docs/DEPLOY-DEMO.md.
// The browser always talks to this origin; Vite forwards /api server-side (the
// browser never sees a different origin), so session cookies work with no
// CORS or cross-origin cookie handling needed. Used by `vite dev` normally,
// and by `vite preview` for the real-mode Playwright harness (client/e2e-real/),
// which points VITE_API_TARGET at the test server (server/e2e/testServer.mjs).
const apiProxy = { '/api': process.env.VITE_API_TARGET || 'http://localhost:4000' }

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
  plugins: [react(), tailwindcss()],
  test: {
    exclude: ['**/node_modules/**', '**/e2e/**', '**/e2e-real/**'],
  },
})
