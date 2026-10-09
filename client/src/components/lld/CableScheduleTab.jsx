import { useState } from 'react'
import { Download, Wand2, AlertTriangle } from 'lucide-react'
import { DEPLOYMENT_PLACEHOLDER } from '@rackium/shared/lldModel.js'
import { exportCableScheduleXlsx } from '../../lib/lldExport.js'
import { useRole } from '../../lib/RoleContext.jsx'
import { canEditLld } from '../../lib/permissions.js'

// `editable` (real mode) overrides the mock role check; `cableIdSuggestion`
// pre-fills an empty Cable ID (a suggestion, saved only when the user saves).
export default function CableScheduleTab({ rows, buildingCode, checks, onAssignCableId, onAssignAllMissing, onSetEngineerSelected, frozen, editable: editableProp, cableIdSuggestion = null }) {
  const { role } = useRole()
  const editable = (editableProp ?? canEditLld(role)) && !frozen
  const missing = rows.filter((r) => !r.cableId).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(checks.portConflicts > 0 || checks.duplicateCableIds > 0) && (
          <span className="flex items-center gap-1.5 rounded-lg bg-status-red/10 px-2.5 py-1.5 text-xs font-medium text-status-red">
            <AlertTriangle size={14} strokeWidth={2} />
            {checks.portConflicts} port conflict{checks.portConflicts === 1 ? '' : 's'} · {checks.duplicateCableIds} duplicate Cable ID
            {checks.duplicateCableIds === 1 ? '' : 's'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {editable && onAssignAllMissing && missing > 0 && (
            <button
              type="button"
              onClick={onAssignAllMissing}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand"
            >
              <Wand2 size={14} strokeWidth={2} />
              Assign {missing} pending Cable ID{missing === 1 ? '' : 's'}
            </button>
          )}
          <button
            type="button"
            onClick={() => exportCableScheduleXlsx(rows, `${buildingCode}-cable-schedule.xlsx`)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand"
          >
            <Download size={14} strokeWidth={2} />
            Export
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-max text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-text-secondary">
              {['Cable ID', 'Source', 'Hops', 'Destination', 'Media', 'Speed', 'Suggested (m)', 'Engineer Selected (m)', 'Installed (m)', 'Pathway', 'Status'].map(
                (h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <CableRow key={r.id} row={r} editable={editable} onAssignCableId={onAssignCableId} onSetEngineerSelected={onSetEngineerSelected} cableIdSuggestion={cableIdSuggestion} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CableRow({ row, editable, onAssignCableId, onSetEngineerSelected, cableIdSuggestion }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="whitespace-nowrap px-3 py-1.5">
        <CableIdCell row={row} editable={editable} onAssign={onAssignCableId} suggestion={cableIdSuggestion} />
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{row.source.label}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
        {row.horizontalTbd ? <span className="italic">{DEPLOYMENT_PLACEHOLDER}</span> : row.hops.length === 0 ? 'Direct' : row.hops.map((h) => h.label).join(' → ')}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{row.dest.label}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{row.mediaLabel}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{row.speed}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{row.length.suggested ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <EngineerLengthCell row={row} editable={editable} onSet={onSetEngineerSelected} />
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 italic text-text-secondary">{DEPLOYMENT_PLACEHOLDER}</td>
      <td className="whitespace-nowrap px-3 py-1.5">
        {row.length.estimated ? (
          <span title={row.length.estimateReason ?? ''} className="rounded border border-status-amber/40 px-1.5 py-0.5 text-status-amber">
            Estimated
          </span>
        ) : (
          <span className="text-status-green">Surveyed</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{row.statusLabel}</td>
    </tr>
  )
}

function CableIdCell({ row, editable, onAssign, suggestion }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(row.cableId ?? suggestion ?? '')
  const [error, setError] = useState(null)

  if (!editable) return row.cableId ?? <span className="text-status-amber">Pending</span>

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="hover:underline">
        {row.cableId ?? <span className="text-status-amber">Assign…</span>}
      </button>
    )
  }

  async function save() {
    const result = await onAssign(row.id, value)
    if (result.ok) {
      setEditing(false)
      setError(null)
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        className="h-7 w-24 rounded border border-border px-1.5 text-xs focus:border-brand focus:outline-none"
      />
      <button type="button" onClick={save} className="text-status-green">
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-text-secondary">
        Cancel
      </button>
      {error && <span className="text-status-red">{error}</span>}
    </div>
  )
}

function EngineerLengthCell({ row, editable, onSet }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(row.length.engineerSelected ?? row.length.suggested ?? '')

  if (!editable) return row.length.effective ?? '—'

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="hover:underline">
        {row.length.effective ?? '—'}
      </button>
    )
  }

  async function save() {
    const meters = value === '' ? null : Number(value)
    const result = await onSet(row.id, meters)
    if (result.ok) setEditing(false)
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="number"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        className="h-7 w-16 rounded border border-border px-1.5 text-xs focus:border-brand focus:outline-none"
      />
      <button type="button" onClick={save} className="text-status-green">
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-text-secondary">
        Cancel
      </button>
    </div>
  )
}
