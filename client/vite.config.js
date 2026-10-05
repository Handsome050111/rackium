import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// VITE_BASE_PATH lets the demo build be served from a subpath (e.g.
// https://demo.example.com/rackium/) without any code changes — set it to
// e.g. "/rackium/" before `npm run build`. Defaults to root, same as
// before. See docs/DEPLOY-DEMO.md.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  // Development only: the browser talks to the same origin, which Vite forwards
  // to the API, so session cookies work without CORS.
  server: {
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://localhost:4000',
    },
  },
  plugins: [react(), tailwindcss()],
  test: {
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
})
