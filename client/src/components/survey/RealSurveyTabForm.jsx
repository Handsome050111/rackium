import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import SurveyTabFormView from './SurveyTabFormView.jsx'
import { SurveyMediaContext } from './SurveyMediaContext.js'
import { surveyApi } from '../../api/surveyApi.js'
import { filesApi } from '../../api/filesApi.js'
import { getTabDefinition } from '../../lib/surveyFormModel.js'
import { useRealSurveySync } from '../../lib/RealSurveySync.jsx'
import { useProjectRoles } from '../../lib/useProjectRoles.js'
import { newObjectId, baseOf } from '../../lib/realOfflineQueue.js'
import { formatValue } from '../../lib/realSurveyModel.js'

const TEXT_DEBOUNCE_MS = 600

// Tabs opened this session, so one opened online still opens when the
// connection is gone (the "already-open" offline mode).
const openedRecords = new Map()
const recordKey = (projectId, t) => `${projectId}:${t.buildingId}:${t.roomId ?? ''}:${t.tab}`

// The tab definition with the organisation's custom fields shown at the end
// of its first section (stored and shown, never counted — brief §5.2).
function withCustomFields(tabDef, customFields) {
  if (!customFields?.length) return tabDef
  return { ...tabDef, sections: tabDef.sections.map((s, i) => (i === 0 ? { ...s, fields: [...s.fields, ...customFields] } : s)) }
}

// Component value → stored value: photos and files keep only their ids.
function toStoredValue(value) {
  if (value && typeof value === 'object') return value.fileIds?.length ? { fileIds: value.fileIds } : null
  if (value === '') return null
  return value ?? null
}
function toComponentValue(value) {
  if (value && typeof value === 'object' && value.fileIds) return { ...value, count: value.fileIds.length }
  return value
}

function ConflictNotice({ conflict, onDismiss }) {
  if (!conflict) return null
  return (
    <div role="alert" className="space-y-1 rounded-xl border border-status-amber/40 bg-status-amber/5 p-3 text-xs">
      <div className="flex items-center justify-between gap-2 font-semibold text-status-amber">
        <span className="flex items-center gap-1.5">
          <AlertTriangle size={13} strokeWidth={2} />
          Your save overwrote a newer change{conflict.changedBy ? ` by ${conflict.changedBy}` : ''}
        </span>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="text-[11px] font-medium text-text-secondary hover:text-text">
            Dismiss
          </button>
        )}
      </div>
      {conflict.fields.map((f) => (
        <div key={f.field} className="text-text-secondary">
          <span className="font-medium text-text">{f.field}</span>: {formatValue(f.theirValue)} → {formatValue(f.yourValue)}
          {f.changedBy ? ` (changed by ${f.changedBy}${f.changedAt ? ` at ${new Date(f.changedAt).toLocaleString()}` : ''})` : ''}
        </div>
      ))}
    </div>
  )
}

// Real-mode survey tab: the prototype's form (SurveyTabFormView) on the
// backend. Every change becomes one survey operation (shared/surveyForm.js)
// sent in order — straight away online, queued in IndexedDB offline — and
// shown at once locally. Text is sent after a short pause in typing.
export default function RealSurveyTabForm({ orgId, projectId, buildingId, roomId, tabName, rackLinkFor, onChanged }) {
  const { isOffline, performEdit, addPhoto, photoUrl, revision } = useRealSurveySync()
  const { readOnly, has } = useProjectRoles(orgId, projectId)
  const target = useMemo(() => ({ buildingId, roomId: roomId ?? null, tab: tabName }), [buildingId, roomId, tabName])

  const [record, setRecord] = useState(null)
  const [sections, setSections] = useState(null)
  const [error, setError] = useState(null)
  const [conflict, setConflict] = useState(null)
  const base = useRef(null)
  const chain = useRef(Promise.resolve())
  const inFlight = useRef(0)
  const timers = useRef(new Map())

  const adopt = useCallback((rec, { sectionsToo = true } = {}) => {
    openedRecords.set(recordKey(projectId, rec), rec)
    setRecord(rec)
    base.current = baseOf(rec)
    if (sectionsToo) setSections(rec.sections)
  }, [projectId])

  const load = useCallback(async () => {
    try {
      adopt((await surveyApi.record(orgId, projectId, target)).record)
      setError(null)
    } catch (err) {
      const cached = openedRecords.get(recordKey(projectId, target))
      if (cached && err.status === 0) adopt(cached)
      else setError(err.message)
    }
  }, [orgId, projectId, target, adopt])

  // Keep the cached copy in step with what is shown (including offline edits).
  useEffect(() => {
    if (record && sections) openedRecords.set(recordKey(projectId, record), { ...record, sections })
  }, [projectId, record, sections])

  // Reload on open and after a sync, unless edits are still on their way.
  useEffect(() => {
    if (inFlight.current === 0) load()
  }, [load, revision])

  useEffect(() => {
    const pendingTimers = timers.current
    return () => pendingTimers.forEach((t) => clearTimeout(t.timer))
  }, [])

  function send(op, description) {
    inFlight.current += 1
    chain.current = chain.current
      .then(async () => {
        const res = await performEdit(target, op, base.current, description)
        if (res?.queued) return
        if (res.result.conflict) setConflict(res.result.conflict)
        // Only take the server's sections once nothing newer is waiting.
        adopt(res.record, { sectionsToo: inFlight.current === 1 && timers.current.size === 0 })
        onChanged?.()
      })
      .catch((err) => {
        setError(err.message)
        load()
      })
      .finally(() => {
        inFlight.current -= 1
      })
    return chain.current
  }

  // Text is sent after a pause; the latest value per cell wins.
  function sendDebounced(cellKey, op, description) {
    const existing = timers.current.get(cellKey)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      timers.current.delete(cellKey)
      send(op, description)
    }, TEXT_DEBOUNCE_MS)
    timers.current.set(cellKey, { timer })
  }

  const patchSection = (i, updater) => setSections((prev) => prev.map((s, j) => (j === i ? updater(s) : s)))
  const description = (what) => `${tabName} — ${what}`

  function setField(i, key, value, { rowId, rackId, rowKey } = {}) {
    const stored = toStoredValue(value)
    const op = { kind: 'setField', sectionIndex: i, key, value: stored, ...(rowId ? { rowId } : {}), ...(rackId ? { rackId } : {}), ...(rowKey ? { rowKey } : {}) }
    const shown = toComponentValue(stored)
    if (rowId) patchSection(i, (rows) => rows.map((r) => (r.id === rowId ? { ...r, [key]: shown } : r)))
    else if (rackId) patchSection(i, (list) => list.map((x) => (x.rackId === rackId ? { ...x, [key]: shown } : x)))
    else if (rowKey) patchSection(i, (s) => ({ ...s, [rowKey]: { ...s[rowKey], [key]: shown } }))
    else patchSection(i, (s) => ({ ...s, [key]: shown }))
    const cellKey = `${i}:${rowId ?? rackId ?? rowKey ?? ''}:${key}`
    if (typeof stored === 'string') sendDebounced(cellKey, op, description(key))
    else {
      // A pending debounced text edit for the same cell is superseded.
      const t = timers.current.get(cellKey)
      if (t) {
        clearTimeout(t.timer)
        timers.current.delete(cellKey)
      }
      send(op, description(key))
    }
  }

  const tabDefBase = getTabDefinition(tabName)
  const tabDef = useMemo(() => withCustomFields(tabDefBase, record?.customFields), [tabDefBase, record?.customFields])

  const media = useMemo(
    () => ({
      photoUrl: (id, opts) => photoUrl(id, opts),
      fileUrl: (id) => filesApi.contentUrl(orgId, projectId, id),
      addFiles: (files, { kind }) => Promise.all(files.map((f) => addPhoto(f, { attachedTo: { type: 'surveyTab', ...target }, category: kind === 'photo' ? 'photo_reference' : 'document', compress: kind === 'photo' }))),
    }),
    [photoUrl, addPhoto, orgId, projectId, target]
  )

  if (error && !record) return <div className="p-4 text-xs text-status-red">{error}</div>
  if (!record || !sections) return <div className="p-4 text-xs text-text-secondary">Loading…</div>

  const isFieldEngineer = has('field_engineer')
  const canPrefill = has('architect') || has('pm')
  const status = record.status
  // The Field Engineer edits anything until it is submitted (an edit after
  // verification reverts the tab to Draft, server-side, with an audit
  // entry); Architects and PMs fill prefill fields before submission.
  const editable = !readOnly && status !== 'submitted' && (isFieldEngineer || (canPrefill && ['draft', 'rejected'].includes(status)))
  // Non-prefill fields stay read-only for Architects/PMs: shown through the
  // same form, the server refuses them — the view marks only what they can set.
  const viewTabDef = !isFieldEngineer && canPrefill ? { ...tabDef, sections: tabDef.sections.map((s) => ({ ...s, fields: s.fields.map((f) => (f.prefill || f.custom ? f : { ...f, readOnlyForRole: true })) })) } : tabDef

  async function transition(action, reason) {
    try {
      const res = await surveyApi.transition(orgId, projectId, { ...target, action, reason })
      adopt(res.record)
      setError(null)
      onChanged?.()
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  const handlers = {
    onKeyValueChange: (i, key, v) => setField(i, key, v),
    onConfirmField: (i, key) => {
      patchSection(i, (s) => ({ ...s, [`${key}__confirmed`]: true }))
      send({ kind: 'confirmField', sectionIndex: i, key, confirmed: true }, description(`${key} validated on site`))
    },
    onCellChange: (i, rowId, key, v) => setField(i, key, v, { rowId }),
    onConfirmCell: (i, rowId, key) => {
      patchSection(i, (rows) => rows.map((r) => (r.id === rowId ? { ...r, [`${key}__confirmed`]: true } : r)))
      send({ kind: 'confirmField', sectionIndex: i, key, confirmed: true, rowId }, description(`${key} validated on site`))
    },
    onAddRow: (i) => {
      const rowId = newObjectId()
      patchSection(i, (rows) => [...rows, { id: rowId }])
      send({ kind: 'addRow', sectionIndex: i, rowId }, description('row added'))
    },
    onDuplicateRow: (i, rowId) => {
      const newRowId = newObjectId()
      patchSection(i, (rows) => {
        const at = rows.findIndex((r) => r.id === rowId)
        return at < 0 ? rows : [...rows.slice(0, at + 1), { ...rows[at], id: newRowId }, ...rows.slice(at + 1)]
      })
      send({ kind: 'duplicateRow', sectionIndex: i, rowId, newRowId }, description('row duplicated'))
    },
    onRemoveRow: (i, rowId) => {
      patchSection(i, (rows) => rows.filter((r) => r.id !== rowId))
      send({ kind: 'removeRow', sectionIndex: i, rowId }, description('row removed'))
    },
    onItemListCellChange: (i, rowKey, col, v) => setField(i, col, v, { rowKey }),
    onRackFieldChange: (i, rackId, key, v) => setField(i, key, v, { rackId }),
    // Checked on the server against the building's CMO devices and the project's serials.
    onValidateSerial: async (serial) => {
      try {
        return (await surveyApi.checkSerial(orgId, projectId, buildingId, serial)).status
      } catch {
        return null
      }
    },
    onSubmit: () => transition('submit'),
    onVerify: () => transition('verify'),
    onReject: (reason) => transition('reject', reason),
    onAddCustomField: async (field) => {
      try {
        await surveyApi.addCustomField(orgId, projectId, { tab: tabName, label: field.label, type: field.type })
        await load()
      } catch (err) {
        setError(err.message)
      }
    },
  }

  const notice = (
    <>
      {record.changedAfterImport && (
        <p className="rounded-lg border border-status-amber/40 bg-status-amber/5 px-3 py-2 text-xs text-status-amber">Survey changed after import — the HLD is flagged until this tab is verified and imported again.</p>
      )}
      <ConflictNotice conflict={conflict} onDismiss={() => setConflict(null)} />
    </>
  )

  return (
    <SurveyMediaContext.Provider value={media}>
      <SurveyTabFormView
        tabDef={viewTabDef}
        sections={sections}
        status={{ status, rejectReason: record.rejected?.reason ?? null }}
        completeness={record.completeness}
        ctx={record.ctx}
        rackList={record.rackList}
        rackStatsByCode={record.rackStatsByCode}
        buildingId={buildingId}
        rackLinkFor={rackLinkFor}
        canFill={!readOnly && isFieldEngineer}
        canVerify={!readOnly && has('architect')}
        canAddCustom={!readOnly && has('org_admin')}
        editable={editable}
        isOffline={isOffline}
        offlineLabel="Offline — changes are kept on this device and sync when you reconnect"
        error={error}
        notice={notice}
        handlers={handlers}
      />
    </SurveyMediaContext.Provider>
  )
}
