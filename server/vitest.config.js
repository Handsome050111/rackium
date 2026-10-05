import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    // Replica-set startup downloads and boots mongod; the first run is slow.
    hookTimeout: 180000,
    testTimeout: 60000,
    fileParallelism: false,
  },
})
