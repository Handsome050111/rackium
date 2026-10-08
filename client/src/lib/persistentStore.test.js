// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal in-memory IndexedDB: one database, one object store. Each
// transaction commits in a microtask, in creation order — the same ordering
// guarantee real IndexedDB gives readwrite transactions on one store.
function installFakeIndexedDb() {
  const records = new Map()
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction() {
      const ops = []
      const tx = {
        objectStore: () => ({
          put: (rec) => ops.push(() => records.set(rec.name, structuredClone(rec))),
          clear: () => ops.push(() => records.clear()),
          getAll: () => {
            const req = {}
            queueMicrotask(() => {
              req.result = [...records.values()]
              req.onsuccess?.()
            })
            return req
          },
        }),
      }
      queueMicrotask(() => {
        for (const op of ops) op()
        tx.oncomplete?.()
      })
      return tx
    },
  }
  globalThis.indexedDB = {
    open() {
      const req = {}
      queueMicrotask(() => {
        req.result = db
        req.onsuccess?.()
      })
      return req
    },
  }
  return records
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

async function loadStoreWithEdit(name) {
  vi.resetModules()
  const store = await import('./persistentStore.js')
  const state = { value: 'seed' }
  store.registerStore(name, { getSnapshot: () => ({ ...state }), restoreSnapshot: () => {} })
  store.startAutosave()
  state.value = 'edited'
  return store
}

describe('persistentStore', () => {
  let records
  beforeEach(() => {
    records = installFakeIndexedDb()
  })

  // Control: proves the fake records what a pagehide flush writes, so the
  // reset test below fails for the right reason if the guard is removed.
  it('flushes unsaved edits on pagehide', async () => {
    await loadStoreWithEdit('control')
    window.dispatchEvent(new Event('pagehide'))
    await settle()
    expect(records.get('control')?.data.value).toBe('edited')
  })

  it('"Reset demo data" leaves the store empty even though the reload fires pagehide and visibilitychange', async () => {
    const store = await loadStoreWithEdit('reset-target')
    // A real reload fires pagehide (and visibilitychange → hidden) on the
    // outgoing page — the flushes that used to write the edit straight back.
    const reload = vi.fn(() => {
      window.dispatchEvent(new Event('pagehide'))
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await store.resetDemoData(reload)
    await settle()
    // Past several autosave intervals: the timer must be stopped too.
    await new Promise((resolve) => setTimeout(resolve, 1200))

    expect(reload).toHaveBeenCalledOnce()
    expect(records.has('reset-target')).toBe(false)
  })
})
