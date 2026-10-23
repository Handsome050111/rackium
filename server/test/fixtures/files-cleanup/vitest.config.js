import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Only for test/testDbCleanup.test.js, which runs this fixture in a child process.
export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  test: {
    include: ['test/fixtures/files-cleanup/*.fixture.js'],
    environment: 'node',
    setupFiles: ['test/setup/isolation.js'],
    testTimeout: 1000,
    fileParallelism: false,
  },
})
