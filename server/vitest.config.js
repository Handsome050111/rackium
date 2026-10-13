import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    // Gives the run one folder for its in-memory databases and removes it at
    // the end (test/helpers/testDbDirs.js).
    globalSetup: ['test/globalSetup.js'],
    // Replica-set startup downloads and boots mongod; the first run is slow.
    hookTimeout: 180000,
    testTimeout: 60000,
    fileParallelism: false,
  },
})
