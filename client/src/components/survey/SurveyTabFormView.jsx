import { useState } from 'react'
import { CheckCircle2, Send, ShieldCheck, XCircle, WifiOff } from 'lucide-react'
import KeyValueSection from './KeyValueSection.jsx'
import TableSection from './TableSection.jsx'
import ItemListSection from './ItemListSection.jsx'
import GallerySection from './GallerySection.jsx'
import RackLayoutSection from './RackLayoutSection.jsx'
import CustomFieldForm from './CustomFieldForm.jsx'
import { WORKFLOW_LABEL } from '../../lib/surveyFormModel.js'

const STATUS_STYLE = {
  draft: 'text-text-secondary',
  submitted: 'text-status-amber',
  verified: 'text-status-green',
  rejected: 'text-status-red',
  imported: 'text-status-green',
}

// The survey tab form itself — status bar, the tab's sections, workflow
// buttons — with its data and actions passed in. Mock mode (SurveyTabForm)
// and real mode (RealSurveyTabForm) supply their own; `onReject` resolves
// to true when the rejection went through.
export default function SurveyTabFormView({
  tabDef,
  sections,
  status,
  completeness,
  ctx,
  rackList,
  rackStatsByCode,
  buildingId,
  rackLinkFor,
  canFill,
  canVerify,
  canAddCustom,
  editable,
  isOffline,
  offlineLabel = 'Offline — saved locally',
  error,
  notice,
  handlers,
}) {
  const [rejectComment, setRejectComment] = useState('')
  const [showReject, setShowReject] = useState(false)

  async function handleReject() {
    if (await handlers.onReject(rejectComment)) {
      setShowReject(false)
      setRejectComment('')
    }
  }

  return (
    <div className="space-y-4">
      {tabDef.note && <p className="text-xs italic text-text-secondary">{tabDef.note}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span data-testid="tab-status" className={`flex items-center gap-1 text-xs font-semibold ${STATUS_STYLE[status.status]}`}>
            {status.status === 'verified' || status.status === 'imported' ? <CheckCircle2 size={14} strokeWidth={2} /> : status.status === 'rejected' ? <XCircle size={14} strokeWidth={2} /> : null}
            {WORKFLOW_LABEL[status.status]}
          </span>
          {status.rejectReason && status.status === 'rejected' && <span className="text-[11px] text-text-secondary">— {status.rejectReason}</span>}
          {isOffline && (
            <span className="flex items-center gap-1 rounded-full bg-status-amber/10 px-2 py-0.5 text-[11px] font-medium text-status-amber">
              <WifiOff size={11} strokeWidth={2} />
              {offlineLabel}
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

      {notice}
      {error && <p className="text-xs text-status-red">{error}</p>}

      {tabDef.sections.map((section, i) => {
        if (section.layout === 'table') {
          return (
            <TableSection
              key={section.section}
              section={section}
              rows={sections[i]}
              ctx={ctx}
              editable={editable}
              rackStatsByCode={rackStatsByCode}
              onAddRow={() => handlers.onAddRow(i)}
              onDuplicateRow={(rowId) => handlers.onDuplicateRow(i, rowId)}
              onRemoveRow={(rowId) => handlers.onRemoveRow(i, rowId)}
              onCellChange={(rowId, key, v) => handlers.onCellChange(i, rowId, key, v)}
              onConfirmCell={(rowId, key) => handlers.onConfirmCell(i, rowId, key)}
              onValidateSerial={handlers.onValidateSerial}
            />
          )
        }
        if (section.layout === 'item_list') {
          return (
            <ItemListSection
              key={section.section}
              section={section}
              record={sections[i]}
              editable={editable}
              onCellChange={(rowKey, col, v) => handlers.onItemListCellChange(i, rowKey, col, v)}
            />
          )
        }
        if (section.layout === 'gallery') {
          return <GallerySection key={section.section} section={section} record={sections[i]} editable={editable} onFieldChange={(key, v) => handlers.onKeyValueChange(i, key, v)} />
        }
        if (section.repeatable_per === 'rack') {
          return (
            <RackLayoutSection
              key={section.section}
              section={section}
              instances={sections[i]}
              rackList={rackList ?? []}
              buildingId={buildingId}
              rackLinkFor={rackLinkFor}
              editable={editable}
              onFieldChange={(rackId, key, v) => handlers.onRackFieldChange(i, rackId, key, v)}
              onValidateSerial={handlers.onValidateSerial}
            />
          )
        }
        return (
          <KeyValueSection
            key={section.section}
            section={section}
            record={sections[i]}
            ctx={ctx}
            editable={editable}
            onFieldChange={(key, v) => handlers.onKeyValueChange(i, key, v)}
            onConfirmField={(key) => handlers.onConfirmField(i, key)}
            onValidateSerial={handlers.onValidateSerial}
          />
        )
      })}

      {canAddCustom && <CustomFieldForm onAdd={handlers.onAddCustomField} />}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
        {canFill && status.status === 'draft' && (
          <button
            type="button"
            disabled={!completeness.complete}
            onClick={handlers.onSubmit}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey"
          >
            <Send size={13} strokeWidth={2} />
            Submit for verification
          </button>
        )}
        {!completeness.complete && status.status === 'draft' && <span className="text-[11px] text-text-secondary">Fill every "Must" field to submit.</span>}

        {canVerify && status.status === 'submitted' && !showReject && (
          <>
            <button type="button" onClick={handlers.onVerify} className="flex h-9 items-center gap-1.5 rounded-lg bg-status-green px-3 text-xs font-medium text-white hover:opacity-90">
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
