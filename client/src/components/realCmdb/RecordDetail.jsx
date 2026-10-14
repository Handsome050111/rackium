import { useState } from 'react'
import { Network, Pencil } from 'lucide-react'
import ProvenanceBadge from './ProvenanceBadge.jsx'

const input = 'h-touch w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-sm text-text focus:border-brand focus:outline-none'
const DGUV_TONE = { valid: 'text-status-green', expiring_soon: 'text-status-amber', expiring: 'text-status-amber', overdue: 'text-status-red' }

function Field({ label, value, provenance, tone = 'text-text' }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-2 border-b border-border/60 py-1.5 text-xs last:border-0">
      <span className="shrink-0 text-text-secondary">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`break-all text-right font-medium ${tone}`}>{value ?? '—'}</span>
        <ProvenanceBadge provenance={value == null || value === '—' ? null : provenance} />
      </span>
    </div>
  )
}

// One as-built record with each field's provenance; an Architect or PM makes
// operational edits here (asset tag, notes, in service / maintenance, warranty
// and refresh dates) — audited as operational changes.
export default function RecordDetail({ record, canEdit, onSave, onOpenPorts }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const p = record.provenance
  const start = () => {
    setDraft({ assetTag: record.assetTag ?? '', notes: record.notes ?? '', status: record.status === 'maintenance' ? 'maintenance' : 'in_service', warrantyStart: record.lifecycle.warrantyStart ?? '', warrantyEnd: record.lifecycle.warrantyEnd ?? '', refreshDate: record.lifecycle.refreshDate ?? '' })
    setEditing(true)
  }
  async function save() {
    const body = { version: record.version }
    const empty = (v) => (v === '' ? null : v)
    if ((record.assetTag ?? '') !== draft.assetTag) body.assetTag = empty(draft.assetTag.trim())
    if ((record.notes ?? '') !== draft.notes) body.notes = empty(draft.notes.trim())
    if (record.status !== draft.status) body.status = draft.status
    for (const f of ['warrantyStart', 'warrantyEnd', 'refreshDate']) if ((record.lifecycle[f] ?? '') !== draft[f]) body[f] = empty(draft[f])
    if (Object.keys(body).length > 1 && (await onSave(body))) setEditing(false)
    if (Object.keys(body).length === 1) setEditing(false)
  }
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="record-detail">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-words text-base font-bold text-text">{record.hostname ?? record.label}</h2>
          <div className="text-xs text-text-secondary">{[record.roleLabel ?? record.category, record.vendor, record.model].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-text" onClick={onOpenPorts}>
            <Network size={14} strokeWidth={2} /> Ports
          </button>
          {canEdit && !editing && (
            <button type="button" className="inline-flex h-9 items-center gap-1 rounded-lg border border-brand px-2.5 text-xs font-medium text-brand" onClick={start}>
              <Pencil size={14} strokeWidth={2} /> Operational edit
            </button>
          )}
        </div>
      </div>

      <div>
        <Field label="Hostname" value={record.hostname} provenance={p.hostname} />
        <Field label="Model" value={record.model} provenance={p.model} />
        <Field label="Status" value={record.statusLabel} provenance={p.status} tone={record.status === 'maintenance' ? 'text-status-amber' : 'text-status-green'} />
        <Field label="Serial" value={record.serial} provenance={p.serial} />
        <Field label="MAC" value={record.mac} provenance={p.mac} />
        <Field label="Location" value={[record.roomCode, record.rackCode ? `${record.rackCode} RU${record.ru} ${record.face}` : null].filter(Boolean).join(' · ') || null} provenance={p.location} />
        <Field label="PDU outlet" value={record.pduOutlet} provenance={p.pduOutlet} />
        <Field label="Asset tag" value={record.assetTag} provenance={p.assetTag} />
        <Field label="Notes" value={record.notes} provenance={p.notes} />
        {record.dguv && <Field label="DGUV" value={`${record.dguv.label}${record.dguv.dueDate ? ` · due ${record.dguv.dueDate}` : ''}`} provenance={p.dguv} tone={DGUV_TONE[record.dguv.status]} />}
        <Field label="Warranty" value={record.lifecycle.warrantyStart || record.lifecycle.warrantyEnd ? `${record.lifecycle.warrantyStart ?? '?'} → ${record.lifecycle.warrantyEnd ?? '?'}` : null} provenance={p.warrantyEnd ?? p.warrantyStart} />
        <Field label="Refresh" value={record.lifecycle.refreshDate} provenance={p.refreshDate} />
        <Field label="End of sale / life" value={record.lifecycle.eosDate || record.lifecycle.eolDate ? `${record.lifecycle.eosDate ?? '—'} / ${record.lifecycle.eolDate ?? '—'}` : null} provenance={p.eosDate ?? p.eolDate} />
        <Field label="Installed" value={record.installedAt ? `${new Date(record.installedAt).toLocaleDateString()}${record.technician ? ` by ${record.technician}` : ''}` : null} provenance={p.serial} />
        <Field label="Accepted" value={record.acceptedAt ? `${new Date(record.acceptedAt).toLocaleDateString()} by ${record.acceptedBy}` : null} />
      </div>

      {editing && (
        <div className="space-y-2 rounded-lg border border-brand/30 bg-brand/5 p-3" aria-label="Operational edit">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-text-secondary">
              Asset tag
              <input className={input} value={draft.assetTag} onChange={(e) => setDraft({ ...draft, assetTag: e.target.value })} />
            </label>
            <label className="text-xs text-text-secondary">
              Status
              <select className={input} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                <option value="in_service">In service</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </label>
            <label className="text-xs text-text-secondary">
              Warranty start
              <input className={input} type="date" value={draft.warrantyStart} onChange={(e) => setDraft({ ...draft, warrantyStart: e.target.value })} />
            </label>
            <label className="text-xs text-text-secondary">
              Warranty end
              <input className={input} type="date" value={draft.warrantyEnd} onChange={(e) => setDraft({ ...draft, warrantyEnd: e.target.value })} />
            </label>
            <label className="text-xs text-text-secondary">
              Refresh date
              <input className={input} type="date" value={draft.refreshDate} onChange={(e) => setDraft({ ...draft, refreshDate: e.target.value })} />
            </label>
            <label className="text-xs text-text-secondary sm:col-span-2">
              Notes
              <input className={input} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
          </div>
          <p className="text-[11px] text-text-secondary">Saved as an operational change in the audit log.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="h-touch rounded-lg border border-border px-3 text-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="h-touch rounded-lg bg-brand px-3 text-sm font-semibold text-white" onClick={save}>
              Save change
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
