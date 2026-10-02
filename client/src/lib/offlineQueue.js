// Offline survey editing (brief v2.3 §5.2: "a survey opened online keeps
// working offline, including photos, and syncs automatically on
// reconnect... last save wins and the sync screen shows what changed and
// who made the conflicting edit"). This is the app's first mechanism that
// genuinely persists across a page reload — everything else is in-memory
// JS state — so it's the first real use for IndexedDB here.
//
// Split like every other phase: this module is the pure queue/conflict
// logic (testable without a real IndexedDB) plus a thin storage adapter;
// lib/OfflineContext.jsx wires it into React, api/surveyFormsDesign.js
// stays the single source of truth for the actual record data either way.

const DB_NAME = 'rackium-offline'
const STORE_NAME = 'survey-edits'
const DB_VERSION = 1

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
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
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

let idCounter = 1
function newEntryId() {
  return `offline-${Date.now()}-${idCounter++}`
}

// `entry`: { buildingId, tabName, roomId, sectionIndex, kind, args, baseModifiedAt, description }
// `kind` names which api/surveyFormsDesign.js mutator to replay on sync;
// `args` are that mutator's own arguments (minus buildingId/tabName/roomId,
// which are stored separately so a conflict check can look the record up
// without re-parsing args).
export async function queueOfflineEdit(entry) {
  const db = await openDb()
  const record = { id: newEntryId(), queuedAt: new Date().toISOString(), ...entry }
  const tx = db.transaction(STORE_NAME, 'readwrite')
  await requestToPromise(tx.objectStore(STORE_NAME).put(record))
  return record
}

export async function getQueuedEdits() {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const all = await requestToPromise(tx.objectStore(STORE_NAME).getAll())
  return all.sort((a, b) => new Date(a.queuedAt) - new Date(b.queuedAt))
}

export async function clearQueuedEdit(id) {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).delete(id)
}

export async function clearAllQueuedEdits() {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).clear()
}

// --- Pure conflict logic (no IndexedDB — easy to unit test) --------------

// A queued edit conflicts when the record it targets was modified (by
// anyone/anything else) after this device queued its own edit while
// offline — "last save wins" per the brief, but the loser is reported, not
// silently dropped.
export function resolveQueuedEdit(entry, currentModifiedAt) {
  if (!currentModifiedAt) return { outcome: 'applied', entry } // record has never been touched by anyone
  // A record this device never saw being edited before (baseModifiedAt
  // null — it went offline on a pristine record) still conflicts if
  // *anyone* touched it while offline; treat the missing base as "the
  // beginning of time" rather than skipping the comparison.
  const conflict = !entry.baseModifiedAt || new Date(currentModifiedAt) > new Date(entry.baseModifiedAt)
  return conflict ? { outcome: 'conflict', entry, currentModifiedAt } : { outcome: 'applied', entry }
}
