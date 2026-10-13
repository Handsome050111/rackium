import { createRunDir, removeDir, sweepLeftovers } from './helpers/testDbDirs.js'

// Runs once per `vitest run`, in the main process, before any worker starts.
// Workers inherit RACKIUM_TEST_DB_RUN, so every in-memory database of this run
// lives in one folder; the teardown removes it even when a test file failed or
// a worker died before its afterAll. A run killed outright (Ctrl+C twice, a
// closed terminal) is caught by the sweep at the start of the next run.
export default function setup() {
  sweepLeftovers()
  const dir = createRunDir()
  process.env.RACKIUM_TEST_DB_RUN = dir
  return () => {
    removeDir(dir)
  }
}
