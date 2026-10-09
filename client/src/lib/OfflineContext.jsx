import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { queueOfflineEdit, getQueuedEdits, clearQueuedEdit, resolveQueuedEdit } from './offlineQueue.js'
import * as surveyFormsDesign from '../api/surveyFormsDesign.js'

const OfflineContext = createContext(null)

// Dev-only "already-open" offline simulation (brief v2.3 §5.2) — there's no
// real network to actually lose, so this is a deliberate toggle rather than
// a navigator.onLine listener, consistent with every other "Prototype
// control" in TopBar.jsx.
export function OfflineProvider({ children }) {
  const [isOffline, setIsOffline] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [lastSyncReport, setLastSyncReport] = useState(null)
  const [syncing, setSyncing] = useState(false)
  // Real mode's queue (lib/RealSurveySync.jsx) reports its own count here so
  // the TopBar badge covers both; it stays 0 in mock mode.
  const [realPending, setRealPending] = useState(0)

  const refreshPendingCount = useCallback(() => {
    getQueuedEdits()
      .then((edits) => setPendingCount(edits.length))
      .catch(() => setPendingCount(0))
  }, [])

  useEffect(() => {
    refreshPendingCount()
  }, [refreshPendingCount])

  // Called by survey form fields instead of the api/surveyFormsDesign.js
  // mutator directly — online, it's a transparent passthrough; offline, the
  // edit is queued in IndexedDB instead of reaching the shared store, and
  // the caller is responsible for its own optimistic local display (it
  // already has the value the user just typed).
  const performEdit = useCallback(
    async (kind, args, meta) => {
      if (!isOffline) {
        return surveyFormsDesign[kind](...args)
      }
      const baseModifiedAt = await surveyFormsDesign.getRecordModifiedAt(meta.buildingId, meta.tabName, meta.roomId)
      await queueOfflineEdit({ ...meta, kind, args, baseModifiedAt })
      refreshPendingCount()
      return { ok: true, queued: true }
    },
    [isOffline, refreshPendingCount]
  )

  const syncNow = useCallback(async () => {
    setSyncing(true)
    const edits = await getQueuedEdits()
    const results = []
    for (const entry of edits) {
      const currentModifiedAt = await surveyFormsDesign.getRecordModifiedAt(entry.buildingId, entry.tabName, entry.roomId)
      const resolution = resolveQueuedEdit(entry, currentModifiedAt)
      // "Last save wins" (brief) — the sync action is itself the last save,
      // so the queued edit always gets applied; a conflict is reported, not
      // blocked, so the user knows it overwrote a concurrent change.
      await surveyFormsDesign[entry.kind](...entry.args)
      await clearQueuedEdit(entry.id)
      results.push({ ...resolution, description: entry.description })
    }
    setLastSyncReport(results)
    setSyncing(false)
    refreshPendingCount()
    return results
  }, [refreshPendingCount])

  function setOffline(value) {
    setIsOffline(value)
    if (!value) syncNow()
    else setLastSyncReport(null)
  }

  return (
    <OfflineContext.Provider value={{ isOffline, setOffline, pendingCount, lastSyncReport, syncing, syncNow, performEdit, realPending, setRealPending }}>
      {children}
    </OfflineContext.Provider>
  )
}

export function useOffline() {
  const ctx = useContext(OfflineContext)
  if (!ctx) throw new Error('useOffline must be used within an OfflineProvider')
  return ctx
}
