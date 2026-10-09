import { useCallback, useEffect, useState } from 'react'
import SurveyTabFormView from './SurveyTabFormView.jsx'
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

export default function SurveyTabForm({ buildingId, tabName, roomId, onChanged }) {
  const { role } = useRole()
  const { isOffline, performEdit } = useOffline()
  const [context, setContext] = useState(null)
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
  async function handleReject(rejectComment) {
    const result = await rejectSurveyTab(buildingId, tabName, roomId, role, rejectComment)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setError(null)
    reload()
    return true
  }
  async function handleAddCustomField(field) {
    const result = await addCustomField(tabName, field, role)
    if (!result.ok) return setError(result.error)
    setError(null)
    reload()
  }

  return (
    <SurveyTabFormView
      tabDef={tabDef}
      sections={record.sections}
      status={status}
      completeness={completeness}
      ctx={ctx}
      rackList={rackList}
      rackStatsByCode={rackStatsByCode}
      buildingId={buildingId}
      canFill={canFill}
      canVerify={canVerify}
      canAddCustom={canAddCustom}
      editable={editable}
      isOffline={isOffline}
      error={error}
      handlers={{
        onKeyValueChange: handleKeyValueChange,
        onConfirmField: handleConfirmField,
        onCellChange: handleCellChange,
        onConfirmCell: handleConfirmCell,
        onAddRow: handleAddRow,
        onDuplicateRow: handleDuplicateRow,
        onRemoveRow: handleRemoveRow,
        onItemListCellChange: handleItemListCellChange,
        onRackFieldChange: handleRackFieldChange,
        onValidateSerial: handleValidateSerial,
        onSubmit: handleSubmit,
        onVerify: handleVerify,
        onReject: handleReject,
        onAddCustomField: handleAddCustomField,
      }}
    />
  )
}
