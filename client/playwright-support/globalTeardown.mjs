import { sweepLeftovers, pidAlive } from '../../server/test/helpers/testDbDirs.js'

// The real-mode e2e server (server/e2e/testServer.mjs) keeps its in-memory
// database in a folder that only its own clean shutdown removes, and
// Playwright force-kills web servers on Windows. Global teardown runs before
// the web servers are stopped, so ask the server to stop itself and wait until
// its PROCESS has exited — it removes its database folder on the way out, and
// Playwright force-kills whatever is still running — then sweep anything a
// dead run left behind.
export const E2E_SERVER = 'http://localhost:4100'

export async function stopE2eServer({ base = E2E_SERVER, timeoutMs = 30000, fetchImpl = fetch, isAlive = pidAlive } = {}) {
  let pid = null
  try {
    const res = await fetchImpl(`${base}/__e2e/shutdown`, { method: 'POST' })
    pid = (await res.json().catch(() => ({}))).pid ?? null
  } catch {
    return 'not_running'
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pid != null ? !isAlive(pid) : await fetchImpl(`${base}/api/v1/health`).then(() => false, () => true)) return 'stopped'
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return 'still_running'
}

export default async function globalTeardown() {
  await stopE2eServer()
  sweepLeftovers()
}
