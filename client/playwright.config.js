import { defineConfig, devices } from '@playwright/test'

// All projects use Chromium (already installed) with different
// viewport/touch settings rather than Playwright's iPad/iPhone device
// presets, which default to WebKit and would need a separate browser
// download. Touch is emulated via `hasTouch`, which Chromium supports.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Full multi-project runs on this machine produced a handful of timing
  // failures under 4+ workers that always passed alone (never the same test
  // twice) — capped concurrency and one retry absorb that without masking a
  // real regression: anything that only passes on retry is still reported
  // (see docs/BUG-SWEEP.md, "Flaky" section) rather than silently accepted.
  workers: 2,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  // Production build + `vite preview`, not `vite dev` — the dev server's
  // per-request transform/HMR overhead was enough, under several heavy
  // multi-step e2e flows running concurrently, to make requests occasionally
  // time out (and, once, to serve two separate module instances of the same
  // file — see api/designFreeze.js's comment). The preview server serves
  // pre-built static assets, which is both faster and immune to that whole
  // class of dev-mode issue.
  //
  // The real-mode harness (client/e2e-real/) needs its own backend and its
  // own real-mode client build, so it gets its own webServer entries on
  // different ports. Playwright starts every entry regardless of which
  // project is actually run — a mock-only run pays a small, fixed startup
  // cost for a server it doesn't use, which is accepted here rather than
  // adding config complexity to avoid it.
  webServer: [
    {
      command: 'npm run build && npm run preview -- --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      // server/e2e/testServer.mjs — same app as production, an in-memory
      // Mongo replica set, rate limits off. Sent emails land in
      // server/e2e/.runtime-emails.json for the specs to read directly.
      command: 'node ../server/e2e/testServer.mjs',
      url: 'http://localhost:4100/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: { E2E_SERVER_PORT: '4100', E2E_CLIENT_ORIGIN: 'http://localhost:5174' },
    },
    {
      // VITE_API_MODE is read by src/lib/apiMode.js at build time (Vite merges
      // process.env over any .env file for VITE_-prefixed keys, no .env.real
      // needed). --outDir dist-real keeps this build separate from the mock
      // build's dist/. VITE_API_TARGET points this preview's /api proxy
      // (vite.config.js) at the test server.
      command: 'npm run build -- --outDir dist-real && npm run preview -- --outDir dist-real --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: { VITE_API_MODE: 'real', VITE_API_TARGET: 'http://localhost:4100' },
    },
  ],
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'iPad-landscape', use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: 'tablet-portrait', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    // Real backend + real-mode client. Separate testDir: mock-mode specs
    // (above) are untouched and never run against this project.
    { name: 'real', testDir: './e2e-real', use: { viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:5174' } },
  ],
})
