// Real-mode offline survey queue (brief v2.3 §5.2, DATA-MODEL §5.7): a tab
// opened online keeps working offline. Edits (each one survey operation, the
// same shape the server's edit endpoint takes) and photos (the compressed
// blob, under the id the edit already references) wait in IndexedDB until
// the connection is back; then photos upload (resuming where they stopped)
// and the edits go to the sync endpoint in the order they were made.
//
// Kept apart from lib/offlineQueue.js, which is mock mode's and unchanged.

const DB_NAME = 'rackium-offline-real'
const DB_VERSION = 1
const EDITS = 'edits'
const UPLOADS = 'uploads'

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available in this browser'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(EDITS)) db.createObjectStore(EDITS, { keyPath: 'opId' })
      if (!db.objectStoreNames.contains(UPLOADS)) db.createObjectStore(UPLOADS, { keyPath: 'fileId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const result = fn(tx.objectStore(store))
        tx.oncomplete = () => resolve(result?.result ?? result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
  )
}

// Edits: { opId, projectKey, queuedAt, buildingId, roomId, tab, op, baseLastModifiedAt, description }
export const putEdit = (edit) => run(EDITS, 'readwrite', (s) => s.put(edit))
export const deleteEdits = (opIds) => run(EDITS, 'readwrite', (s) => opIds.forEach((id) => s.delete(id)))
export async function listEdits(projectKey) {
  const all = await run(EDITS, 'readonly', (s) => s.getAll())
  return all.filter((e) => e.projectKey === projectKey).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

// Uploads: { fileId, projectKey, blob, sha256, meta: { fileName, mimeType, category, attachedTo, capturedAt } }
export const putUpload = (upload) => run(UPLOADS, 'readwrite', (s) => s.put(upload))
export const deleteUpload = (fileId) => run(UPLOADS, 'readwrite', (s) => s.delete(fileId))
export const getUpload = (fileId) => run(UPLOADS, 'readonly', (s) => s.get(fileId))
export async function listUploads(projectKey) {
  const all = await run(UPLOADS, 'readonly', (s) => s.getAll())
  return all.filter((u) => u.projectKey === projectKey)
}

// --- Pure planning (unit-tested) ---------------------------------------------

// 24-hex ids, like the server's, chosen on the device so an edit made
// offline can already reference its row or photo.
export function newObjectId() {
  const seconds = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')
  return `${seconds}${random}`.slice(0, 24)
}

export function fileIdsOf(op) {
  return op?.value?.fileIds ?? []
}

// Which queued edits can go now: in queued order, stopping at the first edit
// that references a photo still uploading (so nothing jumps ahead of it on
// the same tab — order is what "last save wins" is about).
export function editsReadyToSync(edits, pendingFileIds) {
  const pending = new Set(pendingFileIds)
  const ordered = [...edits].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
  const ready = []
  for (const edit of ordered) {
    if (fileIdsOf(edit.op).some((id) => pending.has(id))) break
    ready.push(edit)
  }
  return ready
}

// The server's sync body for queued edits.
export function toSyncBody(edits) {
  return edits.map((e) => ({ opId: e.opId, queuedAt: e.queuedAt, buildingId: e.buildingId, roomId: e.roomId ?? null, tab: e.tab, op: e.op, baseLastModifiedAt: e.baseLastModifiedAt }))
}

// A never-saved tab is compared from the beginning of time, so a colleague's
// first edit made while this device was offline is still reported.
export const EPOCH = new Date(0).toISOString()
export const baseOf = (record) => record?.lastModifiedAt ?? EPOCH

// One line per outcome for the sync report.
export function describeResult(result, edit) {
  const what = edit?.description ?? 'Edit'
  if (result.outcome === 'conflict') return { kind: 'conflict', what, conflict: result.conflict }
  if (result.outcome === 'skipped') return { kind: 'skipped', what, reason: result.reason }
  if (result.outcome === 'rejected') return { kind: 'rejected', what, reason: result.reason }
  return { kind: 'applied', what }
}
