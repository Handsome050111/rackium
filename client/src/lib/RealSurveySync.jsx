import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { surveyApi } from '../api/surveyApi.js'
import { uploadFile, sha256Hex, filesApi } from '../api/filesApi.js'
import { compressPhoto } from './photoCompress.js'
import { useOffline } from './OfflineContext.jsx'
import { putEdit, deleteEdits, listEdits, putUpload, deleteUpload, listUploads, getUpload, newObjectId, editsReadyToSync, toSyncBody, describeResult } from './realOfflineQueue.js'

const RealSurveySyncContext = createContext(null)

// A request that never reached the server (as opposed to one it refused).
const isNetworkError = (err) => err?.status === 0 || err?.code === 'network'

// Real-mode survey editing with the "already-open" offline mode (brief v2.3
// §5.2). Offline = the TopBar's offline simulation switch, or the browser
// actually losing its connection. Online, edits go straight to the API;
// offline (or when a request cannot reach the server) they are queued in
// IndexedDB with the tab's base timestamp. On reconnect, queued photos
// upload first (resuming), then the edits sync in order; the server applies
// them (last save wins) and reports conflicts, which the sync report shows.
export function RealSurveySyncProvider({ orgId, projectId, children }) {
  const { isOffline: simulatedOffline, setRealPending } = useOffline()
  const [browserOffline, setBrowserOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)
  const isOffline = simulatedOffline || browserOffline
  const projectKey = `${orgId}/${projectId}`
  const [pending, setPending] = useState({ edits: 0, uploads: 0 })
  const [syncing, setSyncing] = useState(false)
  const [report, setReport] = useState(null)
  const [revision, setRevision] = useState(0) // bumps after a sync so open screens reload
  const previewUrls = useRef(new Map())
  const syncingRef = useRef(false)

  useEffect(() => {
    const on = () => setBrowserOffline(false)
    const off = () => setBrowserOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const refreshPending = useCallback(async () => {
    try {
      const [edits, uploads] = await Promise.all([listEdits(projectKey), listUploads(projectKey)])
      setPending({ edits: edits.length, uploads: uploads.length })
      setRealPending?.(edits.length + uploads.length)
      return edits.length + uploads.length
    } catch {
      setPending({ edits: 0, uploads: 0 })
      return 0
    }
  }, [projectKey, setRealPending])

  useEffect(() => () => setRealPending?.(0), [setRealPending])

  useEffect(
    () => () => {
      for (const url of previewUrls.current.values()) URL.revokeObjectURL(url)
    },
    []
  )

  const queueEdit = useCallback(
    async (target, op, baseLastModifiedAt, description) => {
      const edit = { opId: `op-${newObjectId()}`, projectKey, queuedAt: new Date().toISOString(), buildingId: target.buildingId, roomId: target.roomId ?? null, tab: target.tab, op, baseLastModifiedAt, description }
      await putEdit(edit)
      await refreshPending()
      return { queued: true }
    },
    [projectKey, refreshPending]
  )

  const uploadQueued = useCallback(
    async (upload) => {
      await uploadFile(orgId, projectId, upload.blob, { fileId: upload.fileId, ...upload.meta }, { sha256: upload.sha256 })
      await deleteUpload(upload.fileId)
    },
    [orgId, projectId]
  )

  // Online: send now. Offline, or the server cannot be reached: queue it.
  const performEdit = useCallback(
    async (target, op, baseLastModifiedAt, description) => {
      if (isOffline) return queueEdit(target, op, baseLastModifiedAt, description)
      try {
        return await surveyApi.edit(orgId, projectId, { ...target, op, baseLastModifiedAt })
      } catch (err) {
        if (isNetworkError(err)) return queueEdit(target, op, baseLastModifiedAt, description)
        throw err
      }
    },
    [isOffline, orgId, projectId, queueEdit]
  )

  // Compresses and stores a photo under a new id, uploading it now when
  // online. Returns the id, which the caller references in its edit at once.
  const addPhoto = useCallback(
    async (file, { attachedTo, category = 'photo_reference', compress = true }) => {
      const prepared = compress && file.type.startsWith('image/') ? await compressPhoto(file) : { blob: file, fileName: file.name, mimeType: file.type || 'application/octet-stream' }
      const fileId = newObjectId()
      const upload = {
        fileId,
        projectKey,
        blob: prepared.blob,
        sha256: await sha256Hex(prepared.blob),
        meta: { fileName: prepared.fileName, mimeType: prepared.mimeType, category, attachedTo, capturedAt: new Date().toISOString() },
      }
      previewUrls.current.set(fileId, URL.createObjectURL(prepared.blob))
      await putUpload(upload)
      if (!isOffline) {
        try {
          await uploadQueued(upload)
        } catch (err) {
          if (!isNetworkError(err)) {
            await deleteUpload(fileId)
            await refreshPending()
            throw err
          }
          // Interrupted: it stays queued and resumes on the next sync.
        }
      }
      await refreshPending()
      return { fileId, fileName: prepared.fileName }
    },
    [projectKey, isOffline, uploadQueued, refreshPending]
  )

  // A photo's picture: the local copy while it waits to upload, else the
  // server's thumbnail (an authorised, cookie-carrying request).
  const photoUrl = useCallback((fileId, { full = false } = {}) => previewUrls.current.get(fileId) ?? (full ? filesApi.contentUrl(orgId, projectId, fileId) : filesApi.thumbnailUrl(orgId, projectId, fileId)), [orgId, projectId])

  const syncNow = useCallback(async () => {
    if (syncingRef.current) return null
    syncingRef.current = true
    setSyncing(true)
    const lines = []
    try {
      // 1. Photos, resuming any that were interrupted.
      const failedUploads = []
      for (const upload of await listUploads(projectKey)) {
        try {
          await uploadQueued(upload)
        } catch (err) {
          failedUploads.push(upload.fileId)
          if (!isNetworkError(err)) lines.push({ kind: 'rejected', what: `Photo ${upload.meta.fileName}`, reason: err.message })
        }
      }
      // 2. Edits, in order, held back behind a photo that has not arrived.
      const edits = await listEdits(projectKey)
      const ready = editsReadyToSync(edits, failedUploads)
      for (let i = 0; i < ready.length; i += 500) {
        const batch = ready.slice(i, i + 500)
        const { results } = await surveyApi.sync(orgId, projectId, toSyncBody(batch))
        const byOp = new Map(batch.map((e) => [e.opId, e]))
        results.forEach((r) => lines.push(describeResult(r, byOp.get(r.opId))))
        await deleteEdits(results.map((r) => r.opId))
      }
      if (lines.length) setReport({ at: new Date().toISOString(), lines })
      return lines
    } catch (err) {
      if (!isNetworkError(err)) setReport({ at: new Date().toISOString(), lines: [...lines, { kind: 'rejected', what: 'Sync', reason: err.message }] })
      return lines
    } finally {
      syncingRef.current = false
      setSyncing(false)
      await refreshPending()
      setRevision((r) => r + 1)
    }
  }, [orgId, projectId, projectKey, uploadQueued, refreshPending])

  // Reconnecting (or switching the simulation off) syncs automatically.
  const wasOffline = useRef(isOffline)
  useEffect(() => {
    if (wasOffline.current && !isOffline) syncNow()
    wasOffline.current = isOffline
  }, [isOffline, syncNow])

  // Anything left from an earlier session (e.g. the tab was closed offline)
  // goes as soon as the project opens online.
  useEffect(() => {
    let active = true
    refreshPending().then((total) => {
      if (active && total > 0 && !wasOffline.current) syncNow()
    })
    return () => {
      active = false
    }
    // Only on mount / project change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey])

  const value = useMemo(
    () => ({ isOffline, pending, syncing, report, clearReport: () => setReport(null), revision, performEdit, addPhoto, photoUrl, syncNow, getQueuedUpload: getUpload }),
    [isOffline, pending, syncing, report, revision, performEdit, addPhoto, photoUrl, syncNow]
  )
  return <RealSurveySyncContext.Provider value={value}>{children}</RealSurveySyncContext.Provider>
}

export function useRealSurveySync() {
  const ctx = useContext(RealSurveySyncContext)
  if (!ctx) throw new Error('useRealSurveySync must be used within a RealSurveySyncProvider')
  return ctx
}
