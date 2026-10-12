import { sweepLeftovers } from '../../server/test/helpers/testDbDirs.js'

// The real-mode e2e server (server/e2e/testServer.mjs) keeps its in-memory
// database in a folder that only its own clean shutdown removes, and
// Playwright force-kills web servers on Windows. Global teardown runs before
// the web servers are stopped, so ask the server to stop itself, wait until it
// has gone, then sweep anything a dead run left behind.
export const E2E_SERVER = 'http://localhost:4100'

export async function stopE2eServer({ base = E2E_SERVER, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  try {
    await fetchImpl(`${base}/__e2e/shutdown`, { method: 'POST' })
  } catch {
    return 'not_running'
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetchImpl(`${base}/api/v1/health`)
    } catch {
      return 'stopped'
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return 'still_running'
}

export default async function globalTeardown() {
  await stopE2eServer()
  sweepLeftovers()
}
