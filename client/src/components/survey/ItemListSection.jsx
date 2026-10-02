import FormField from './FormField.jsx'
import RequirementBadge from './RequirementBadge.jsx'

function columnLabel(column) {
  return column
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function columnFieldType(column) {
  if (column === 'photograph') return 'photo'
  if (column === 'height_required') return 'number'
  return 'text'
}

// Passive Requirements for FMO's distinctive shape: the JSON's `fields` are
// fixed ROWS (requirement types), `item_columns` are the columns captured
// per row (placement floor/location, height, details, remark, photo) — the
// inverse of a normal table, so it gets its own small layout rather than
// being forced through TableSection.
export default function ItemListSection({ section, record, editable, onCellChange }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 text-sm font-semibold text-text">{section.section}</div>

      {/* Table (sm and up) */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-max text-left text-xs">
          <thead>
            <tr className="border-b border-border text-text-secondary">
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Item</th>
              {section.item_columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium">
                  {columnLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.fields.map((row) => (
              <tr key={row.key} className="border-b border-border/60 last:border-0">
                <td className="min-w-[200px] px-2 py-1.5 align-top">
                  <span className="flex items-center gap-1 font-medium text-text">
                    {row.label}
                    <RequirementBadge requirement={row.requirement} />
                  </span>
                </td>
                {section.item_columns.map((c) => (
                  <td key={c} className="min-w-[140px] px-2 py-1.5 align-top">
                    <FormField
                      compact
                      field={{ key: c, label: columnLabel(c), type: columnFieldType(c), requirement: row.requirement }}
                      value={record?.[row.key]?.[c]}
                      editable={editable}
                      onChange={(v) => onCellChange(row.key, c, v)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked cards (phone) */}
      <div className="space-y-3 sm:hidden">
        {section.fields.map((row) => (
          <div key={row.key} className="space-y-2 rounded-lg border border-border p-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-text">
              {row.label}
              <RequirementBadge requirement={row.requirement} />
            </span>
            {section.item_columns.map((c) => (
              <FormField
                key={c}
                field={{ key: c, label: columnLabel(c), type: columnFieldType(c), requirement: row.requirement }}
                value={record?.[row.key]?.[c]}
                editable={editable}
                onChange={(v) => onCellChange(row.key, c, v)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
