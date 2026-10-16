import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Only for test/isolation.test.js, which runs this fixture in a child process.
export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  test: {
    include: ['test/fixtures/isolation/*.fixture.js'],
    environment: 'node',
    setupFiles: ['test/setup/isolation.js'],
    hookTimeout: 180000,
    fileParallelism: false,
  },
})
