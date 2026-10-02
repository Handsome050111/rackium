// HLD version bookkeeping (brief v2.3 §5.4 / §6.10): LLD records which HLD
// version it is based on, and must notice when HLD changes underneath it.
// Every HLD mutation in api/hld.js records a change here; one user action
// that touches several records (Generate HLD) is batched into one version.
import { registerStore } from '../lib/persistentStore.js'

const state = { version: 1, changes: [] } // changes: { version, at, summaries[] }
let batchDepth = 0
let pending = []

// batchDepth/pending are transient mid-batch bookkeeping, not demo data —
// they're always 0/[] between user actions, so there's nothing to restore.
registerStore('hldVersion', {
  getSnapshot: () => state,
  restoreSnapshot: (data) => {
    if (typeof data?.version === 'number') state.version = data.version
    if (data?.changes) state.changes = data.changes
  },
})

function commit(summaries) {
  state.version += 1
  state.changes.push({ version: state.version, at: new Date().toISOString(), summaries })
}

export function getHldVersion() {
  return state.version
}

export function getHldChangesSince(version) {
  return state.changes.filter((c) => c.version > version)
}

export function recordHldChange(summary) {
  if (batchDepth > 0) {
    pending.push(summary)
    return
  }
  commit([summary])
}

export async function inHldBatch(fn) {
  batchDepth += 1
  try {
    return await fn()
  } finally {
    batchDepth -= 1
    if (batchDepth === 0 && pending.length > 0) {
      commit(pending)
      pending = []
    }
  }
}
