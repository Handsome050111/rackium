// Transparent whole-store persistence for the demo (final step: "persist
// the ENTIRE mock store ... so all screens stay consistent after reload").
// Every api/*.js (and mock/powerStandards.js) module that holds mutable
// state registers a getSnapshot/restoreSnapshot pair here at import time —
// components never know this exists. main.jsx calls hydrateAll() once,
// before the app renders; startAutosave() then periodically snapshots
// every registered module back to IndexedDB.
//
// Separate IndexedDB database from lib/offlineQueue.js, which queues
// *edits to replay* for the survey-offline feature, not a state snapshot —
// no name/version collision between the two.

const DB_NAME = 'rackium-demo-state'
const STORE_NAME = 'modules'
const DB_VERSION = 1
const AUTOSAVE_INTERVAL_MS = 2000

const registry = new Map() // name -> { getSnapshot, restoreSnapshot }

export function registerStore(name, { getSnapshot, restoreSnapshot }) {
  registry.set(name, { getSnapshot, restoreSnapshot })
}

// Two small helpers so every module's restoreSnapshot can replace a
// const-bound object/array's *contents* in place (the binding itself can't
// be reassigned from outside, and many of these are read by reference
// elsewhere in the same file).
export function replaceObjectContents(target, data) {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, data ?? {})
}
export function replaceArrayContents(target, data) {
  target.length = 0
  if (Array.isArray(data)) target.push(...data)
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// Called once at startup, before the app renders, so every registered
// module is hydrated from its last-saved snapshot before any component
// reads from it. Safe to call with nothing persisted yet (first visit) —
// every module simply keeps its own seed state.
export async function hydrateAll() {
  let db
  try {
    db = await openDb()
  } catch {
    return // IndexedDB unavailable (e.g. private browsing) — start from seed data
  }
  let records = []
  try {
    const tx = db.transaction(STORE_NAME, 'readonly')
    records = await requestToPromise(tx.objectStore(STORE_NAME).getAll())
  } catch {
    return
  }
  for (const record of records) {
    const entry = registry.get(record.name)
    if (!entry) continue
    try {
      entry.restoreSnapshot(record.data)
    } catch (err) {
      console.error(`Failed to restore demo state for "${record.name}"`, err)
    }
  }
}

async function persistAll() {
  let db
  try {
    db = await openDb()
  } catch {
    return
  }
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const [name, entry] of registry) {
      store.put({ name, data: entry.getSnapshot() })
    }
    await txDone(tx)
  } catch {
    // Best-effort — a failed autosave tick just tries again next interval.
  }
}

let autosaveTimer = null
export function startAutosave() {
  if (autosaveTimer) return
  autosaveTimer = setInterval(persistAll, AUTOSAVE_INTERVAL_MS)
  // More reliable than 'beforeunload' for an async IndexedDB write — the
  // tab typically stays alive briefly after visibilitychange fires, but
  // not reliably after beforeunload returns.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistAll()
  })
}

// Dev menu "Reset demo data": wipe the persisted snapshot and reload — a
// fresh load with nothing in IndexedDB naturally re-seeds every module
// from its own static mock data, exactly like the very first visit, so no
// module needs its own separate "reset to seed" logic.
export async function resetDemoData() {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    await txDone(tx)
  } catch {
    // Fall through to reload regardless — worst case the old snapshot
    // (if any) just gets overwritten by the next autosave tick.
  }
  window.location.reload()
}
