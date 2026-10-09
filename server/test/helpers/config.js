import os from 'node:os'
import path from 'node:path'

export const testConfig = (overrides = {}) => ({
  NODE_ENV: 'test',
  PORT: 0,
  MONGODB_URI: 'unused-in-tests',
  JWT_SECRET: 'test-secret-that-is-at-least-thirty-two-characters-long',
  CLIENT_ORIGIN: 'http://localhost:5173',
  PUBLIC_APP_URL: 'http://localhost:5173',
  TRUST_PROXY: 0,
  EMAIL_PROVIDER: 'console',
  EMAIL_FROM: 'Rackium <test@localhost>',
  LOG_LEVEL: 'silent',
  IS_PRODUCTION: false,
  // One fresh directory per test process; files never touch the repo.
  FILE_STORAGE_DIR: path.join(os.tmpdir(), `rackium-test-files-${process.pid}`),
  ...overrides,
})
