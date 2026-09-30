import { defineConfig, devices } from '@playwright/test'

// All projects use Chromium (already installed) with different
// viewport/touch settings rather than Playwright's iPad/iPhone device
// presets, which default to WebKit and would need a separate browser
// download. Touch is emulated via `hasTouch`, which Chromium supports.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'iPad-landscape', use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: 'tablet-portrait', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
})
