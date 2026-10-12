import { Plus, Minus, PenLine } from 'lucide-react'
import { fieldChangeText } from '../../../api/lldApi.js'

const KIND = {
  added: { icon: Plus, className: 'border-status-green/40 bg-status-green/5 text-status-green' },
  removed: { icon: Minus, className: 'border-status-red/40 bg-status-red/5 text-status-red' },
  changed: { icon: PenLine, className: 'border-status-amber/40 bg-status-amber/5 text-status-amber' },
}

// A visual diff of two designs (brief §6.10), or of the HLD against the LLD
// (§5.4): one column per kind of change, devices and connections apart.
// `columns`: [{ kind: 'added'|'removed'|'changed', title, key }];
// `sections`: [{ title, data }] where data[key] is a list of
// { id, label, fields? }. `actionFor(sectionIndex, column, item)` may render
// a per-item action (e.g. "Copy into LLD").
export default function DesignDiff({ columns, sections, actionFor, empty = 'No differences.' }) {
  const total = sections.reduce((n, s) => n + columns.reduce((m, c) => m + (s.data[c.key]?.length ?? 0), 0), 0)
  if (total === 0) return <p className="text-xs text-text-secondary">{empty}</p>
  return (
    <div className="space-y-4" data-testid="design-diff">
      {sections.map((section, si) => (
        <div key={section.title} className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{section.title}</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {columns.map((col) => {
              const items = section.data[col.key] ?? []
              const { icon: Icon, className } = KIND[col.kind]
              return (
                <div key={col.key} className={`min-w-0 rounded-lg border p-2 ${className}`}>
                  <div className="mb-1 flex items-center gap-1 text-xs font-semibold">
                    <Icon size={12} strokeWidth={2.5} />
                    {col.title} ({items.length})
                  </div>
                  <ul className="space-y-1 text-xs text-text">
                    {items.length === 0 && <li className="text-text-secondary">—</li>}
                    {items.map((item) => (
                      <li key={item.id} className="min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="break-words font-medium">{item.label}</span>
                          {actionFor?.(si, col, item)}
                        </div>
                        {item.fields?.map((f) => (
                          <div key={f.field} className="break-words text-text-secondary">
                            {fieldChangeText(f)}
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
