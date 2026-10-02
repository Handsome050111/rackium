import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Send, ShieldCheck, XCircle, WifiOff } from 'lucide-react'
import KeyValueSection from './KeyValueSection.jsx'
import TableSection from './TableSection.jsx'
import ItemListSection from './ItemListSection.jsx'
import GallerySection from './GallerySection.jsx'
import RackLayoutSection from './RackLayoutSection.jsx'
import CustomFieldForm from './CustomFieldForm.jsx'
import {
  getSurveyTabContext,
  addTableRow,
  duplicateTableRow,
  removeTableRow,
  validateSurveySerial,
  submitSurveyTab,
  verifySurveyTab,
  rejectSurveyTab,
  addCustomField,
} from '../../api/surveyFormsDesign.js'
import { useOffline } from '../../lib/OfflineContext.jsx'
import { useRole } from '../../lib/RoleContext.jsx'
import { canFillSurveyForm, canVerifySurveyForm, canAddCustomSurveyField } from '../../lib/permissions.js'
import { WORKFLOW_LABEL } from '../../lib/surveyFormModel.js'

const STATUS_STYLE = {
  draft: 'text-text-secondary',
  submitted: 'text-status-amber',
  verified: 'text-status-green',
  rejected: 'text-status-red',
  imported: 'text-status-green',
}

export default function SurveyTabForm({ buildingId, tabName, roomId, onChanged }) {
  const { role } = useRole()
  const { isOffline, performEdit } = useOffline()
  const [context, setContext] = useState(null)
  const [rejectComment, setRejectComment] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [error, setError] = useState(null)

  const reload = useCallback(() => {
    getSurveyTabContext(buildingId, tabName, roomId).then((ctx) => {
      setContext(ctx)
      onChanged?.()
    })
  }, [buildingId, tabName, roomId, onChanged])

  useEffect(() => {
    setContext(null)
    reload()
  }, [reload])

  if (!context) return <div className="p-4 text-xs text-text-secondary">Loading…</div>

  const { tabDef, record, status, completeness, ctx, rackList, rackStatsByCode } = context
  const canFill = canFillSurveyForm(role)
  const canVerify = canVerifySurveyForm(role)
  const canAddCustom = canAddCustomSurveyField(role)
  const editable = canFill && status.status !== 'verified' && status.status !== 'imported'

  // Offline edits never reach the live store, so the UI applies the same
  // patch locally for immediate feedback (see lib/OfflineContext.jsx).
  function applyLocally(sectionIndex, updater) {
    setContext((prev) => {
      const sections = [...prev.record.sections]
      sections[sectionIndex] = updater(sections[sectionIndex])
      return { ...prev, record: { ...prev.record, sections } }
    })
  }

  async function runEdit(kind, args, sectionIndex, localUpdater) {
    if (isOffline) applyLocally(sectionIndex, localUpdater)
    await performEdit(kind, args, { buildingId, tabName, roomId, description: `${tabDef.tab} edited offline` })
    if (!isOffline) reload()
  }

  function handleKeyValueChange(sectionIndex, fieldKey, value) {
    runEdit('updateKeyValueSection', [buildingId, tabName, roomId, sectionIndex, { [fieldKey]: value }], sectionIndex, (s) => ({ ...s, [fieldKey]: value }))
  }
  function handleConfirmField(sectionIndex, fieldKey) {
    runEdit('confirmPrefillField', [buildingId, tabName, roomId, sectionIndex, fieldKey], sectionIndex, (s) => ({ ...s, [`${fieldKey}__confirmed`]: true }))
  }
  function handleCellChange(sectionIndex, rowId, fieldKey, value) {
    runEdit('updateTableRow', [buildingId, tabName, roomId, sectionIndex, rowId, { [fieldKey]: value }], sectionIndex, (rows) =>
      rows.map((r) => (r.id === rowId ? { ...r, [fieldKey]: value } : r))
    )
  }
  function handleConfirmCell(sectionIndex, rowId, fieldKey) {
    runEdit('updateTableRow', [buildingId, tabName, roomId, sectionIndex, rowId, { [`${fieldKey}__confirmed`]: true }], sectionIndex, (rows) =>
      rows.map((r) => (r.id === rowId ? { ...r, [`${fieldKey}__confirmed`]: true } : r))
    )
  }
  async function handleAddRow(sectionIndex) {
    if (isOffline) return // row identity needs a server id — adding rows offline isn't supported in this prototype
    await addTableRow(buildingId, tabName, roomId, sectionIndex)
    reload()
  }
  async function handleDuplicateRow(sectionIndex, rowId) {
    if (isOffline) return
    await duplicateTableRow(buildingId, tabName, roomId, sectionIndex, rowId)
    reload()
  }
  async function handleRemoveRow(sectionIndex, rowId) {
    if (isOffline) return
    await removeTableRow(buildingId, tabName, roomId, sectionIndex, rowId)
    reload()
  }
  function handleItemListCellChange(sectionIndex, rowKey, column, value) {
    runEdit('updateItemListCell', [buildingId, tabName, roomId, sectionIndex, rowKey, column, value], sectionIndex, (s) => ({
      ...s,
      [rowKey]: { ...s[rowKey], [column]: value },
    }))
  }
  function handleRackFieldChange(sectionIndex, rackId, fieldKey, value) {
    runEdit('updateRackInstance', [buildingId, roomId, rackId, { [fieldKey]: value }], sectionIndex, (instances) =>
      instances.map((i) => (i.rackId === rackId ? { ...i, [fieldKey]: value } : i))
    )
  }

  async function handleValidateSerial(serial) {
    if (!roomId) return 'not-in-cmo'
    return validateSurveySerial(roomId, serial)
  }

  async function handleSubmit() {
    const result = await submitSurveyTab(buildingId, tabName, roomId, role)
    if (!result.ok) return setError(result.error)
    setError(null)
    reload()
  }
  async function handleVerify() {
    const result = await verifySurveyTab(buildingId, tabName, roomId, role)
    if (!result.ok) return setError(result.error)
    setError(null)
    reload()
  }
  async function handleReject() {
    const result = await rejectSurveyTab(buildingId, tabName, roomId, role, rejectComment)
    if (!result.ok) return setError(result.error)
    setError(null)
    setShowReject(false)
    setRejectComment('')
    reload()
  }
  async function handleAddCustomField(field) {
    const result = await addCustomField(tabName, field, role)
    if (!result.ok) return setError(result.error)
    setError(null)
    reload()
  }

  return (
    <div className="space-y-4">
      {tabDef.note && <p className="text-xs italic text-text-secondary">{tabDef.note}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-xs font-semibold ${STATUS_STYLE[status.status]}`}>
            {status.status === 'verified' || status.status === 'imported' ? <CheckCircle2 size={14} strokeWidth={2} /> : status.status === 'rejected' ? <XCircle size={14} strokeWidth={2} /> : null}
            {WORKFLOW_LABEL[status.status]}
          </span>
          {status.rejectReason && status.status === 'rejected' && <span className="text-[11px] text-text-secondary">— {status.rejectReason}</span>}
          {isOffline && (
            <span className="flex items-center gap-1 rounded-full bg-status-amber/10 px-2 py-0.5 text-[11px] font-medium text-status-amber">
              <WifiOff size={11} strokeWidth={2} />
              Offline — saved locally
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-brand" style={{ width: `${completeness.percent}%` }} />
          </div>
          <span className="text-[11px] text-text-secondary">{completeness.percent}% complete</span>
        </div>
      </div>

      {error && <p className="text-xs text-status-red">{error}</p>}

      {tabDef.sections.map((section, i) => {
        if (section.layout === 'table') {
          return (
            <TableSection
              key={section.section}
              section={section}
              rows={record.sections[i]}
              ctx={ctx}
              editable={editable}
              rackStatsByCode={rackStatsByCode}
              onAddRow={() => handleAddRow(i)}
              onDuplicateRow={(rowId) => handleDuplicateRow(i, rowId)}
              onRemoveRow={(rowId) => handleRemoveRow(i, rowId)}
              onCellChange={(rowId, key, v) => handleCellChange(i, rowId, key, v)}
              onConfirmCell={(rowId, key) => handleConfirmCell(i, rowId, key)}
              onValidateSerial={handleValidateSerial}
            />
          )
        }
        if (section.layout === 'item_list') {
          return (
            <ItemListSection
              key={section.section}
              section={section}
              record={record.sections[i]}
              editable={editable}
              onCellChange={(rowKey, col, v) => handleItemListCellChange(i, rowKey, col, v)}
            />
          )
        }
        if (section.layout === 'gallery') {
          return (
            <GallerySection key={section.section} section={section} record={record.sections[i]} editable={editable} onFieldChange={(key, v) => handleKeyValueChange(i, key, v)} />
          )
        }
        if (section.repeatable_per === 'rack') {
          return (
            <RackLayoutSection
              key={section.section}
              section={section}
              instances={record.sections[i]}
              rackList={rackList ?? []}
              buildingId={buildingId}
              editable={editable}
              onFieldChange={(rackId, key, v) => handleRackFieldChange(i, rackId, key, v)}
              onValidateSerial={handleValidateSerial}
            />
          )
        }
        return (
          <KeyValueSection
            key={section.section}
            section={section}
            record={record.sections[i]}
            ctx={ctx}
            editable={editable}
            onFieldChange={(key, v) => handleKeyValueChange(i, key, v)}
            onConfirmField={(key) => handleConfirmField(i, key)}
            onValidateSerial={handleValidateSerial}
          />
        )
      })}

      {canAddCustom && <CustomFieldForm onAdd={handleAddCustomField} />}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
        {canFill && status.status === 'draft' && (
          <button
            type="button"
            disabled={!completeness.complete}
            onClick={handleSubmit}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey"
          >
            <Send size={13} strokeWidth={2} />
            Submit for verification
          </button>
        )}
        {!completeness.complete && status.status === 'draft' && <span className="text-[11px] text-text-secondary">Fill every "Must" field to submit.</span>}

        {canVerify && status.status === 'submitted' && !showReject && (
          <>
            <button type="button" onClick={handleVerify} className="flex h-9 items-center gap-1.5 rounded-lg bg-status-green px-3 text-xs font-medium text-white hover:opacity-90">
              <ShieldCheck size={13} strokeWidth={2} />
              Verify
            </button>
            <button type="button" onClick={() => setShowReject(true)} className="flex h-9 items-center gap-1.5 rounded-lg border border-status-red/40 px-3 text-xs font-medium text-status-red hover:bg-status-red/5">
              <XCircle size={13} strokeWidth={2} />
              Reject
            </button>
          </>
        )}
        {canVerify && showReject && (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Reason for rejection"
              className="h-9 flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs focus:border-brand focus:outline-none"
            />
            <div className="flex gap-2">
              <button type="button" onClick={handleReject} className="h-9 rounded-lg bg-status-red px-3 text-xs font-medium text-white hover:opacity-90">
                Confirm reject
              </button>
              <button type="button" onClick={() => setShowReject(false)} className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
