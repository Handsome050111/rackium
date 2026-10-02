import { Copy, Trash2, Plus } from 'lucide-react'
import FormField from './FormField.jsx'
import RequirementBadge from './RequirementBadge.jsx'
import { calculatedFieldValue } from '../../lib/surveyFormModel.js'

// Repeatable rows — a real table at tablet/desktop width, stacked cards on
// phone (brief: "table layouts become stacked cards on phone"), not just
// the horizontal-scroll pattern used by the read-only data tables
// elsewhere in the app, since these rows are actively edited on-site.
export default function TableSection({ section, rows, ctx, editable, onAddRow, onDuplicateRow, onRemoveRow, onCellChange, onConfirmCell, onValidateSerial, rackStatsByCode }) {
  // Comms Rooms Summary only (brief: "RU counts calculated from the rack
  // survey") — once a row names a real rack, its RU/power columns become
  // calculated instead of re-typed.
  function calculatedFor(row, field) {
    const fromCtx = ctx ? calculatedFieldValue(field.key, ctx) : undefined
    if (fromCtx !== undefined) return fromCtx
    const stats = rackStatsByCode?.[row.rack_number]
    return stats && field.key in stats ? stats[field.key] : undefined
  }
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-text">{section.section}</div>
        {editable && (
          <button type="button" onClick={onAddRow} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-text hover:border-brand">
            <Plus size={12} strokeWidth={2} />
            Add row
          </button>
        )}
      </div>

      {rows.length === 0 && <p className="text-xs text-text-secondary">No rows yet{editable ? ' — add one if this applies to this room.' : '.'}</p>}

      {/* Table (sm and up) */}
      {rows.length > 0 && (
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="border-b border-border text-text-secondary">
                {section.fields.map((f) => (
                  <th key={f.key} className="whitespace-nowrap px-2 py-1.5 font-medium">
                    <span className="flex items-center gap-1">
                      {f.label}
                      <RequirementBadge requirement={f.requirement} />
                    </span>
                  </th>
                ))}
                {editable && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  {section.fields.map((f) => {
                    const calculated = calculatedFor(row, f)
                    return (
                      <td key={f.key} className="min-w-[160px] px-2 py-1.5 align-top">
                        <FormField
                          field={f}
                          compact
                          value={row[f.key]}
                          confirmed={row[`${f.key}__confirmed`]}
                          editable={editable}
                          calculatedValue={calculated}
                          onChange={(v) => onCellChange(row.id, f.key, v)}
                          onConfirm={() => onConfirmCell(row.id, f.key)}
                          onValidateSerial={f.type === 'serial' ? onValidateSerial : undefined}
                        />
                      </td>
                    )
                  })}
                  {editable && (
                    <td className="whitespace-nowrap px-2 py-1.5 align-top">
                      <div className="flex gap-1">
                        <button type="button" onClick={() => onDuplicateRow(row.id)} title="Duplicate row" className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
                          <Copy size={12} strokeWidth={2} />
                        </button>
                        <button type="button" onClick={() => onRemoveRow(row.id)} title="Remove row" className="flex h-7 w-7 items-center justify-center rounded-lg text-status-red hover:bg-status-red/5">
                          <Trash2 size={12} strokeWidth={2} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stacked cards (phone) */}
      <div className="space-y-3 sm:hidden">
        {rows.map((row, i) => (
          <div key={row.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-text-secondary">Row {i + 1}</span>
              {editable && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => onDuplicateRow(row.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
                    <Copy size={12} strokeWidth={2} />
                  </button>
                  <button type="button" onClick={() => onRemoveRow(row.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-status-red hover:bg-status-red/5">
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
            {section.fields.map((f) => {
              const calculated = calculatedFor(row, f)
              return (
                <FormField
                  key={f.key}
                  field={f}
                  value={row[f.key]}
                  confirmed={row[`${f.key}__confirmed`]}
                  editable={editable}
                  calculatedValue={calculated}
                  onChange={(v) => onCellChange(row.id, f.key, v)}
                  onConfirm={() => onConfirmCell(row.id, f.key)}
                  onValidateSerial={f.type === 'serial' ? onValidateSerial : undefined}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
