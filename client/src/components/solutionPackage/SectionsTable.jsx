import { useState } from 'react'
import { FileText, CheckCircle2, AlertTriangle, RotateCw } from 'lucide-react'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'generated', label: 'Generated' },
  { id: 'input_required', label: 'Input required' },
  { id: 'under_review', label: 'Under review' },
  { id: 'validated', label: 'Validated' },
]

const STATUS_META = {
  generated: { label: 'Generated', icon: FileText, color: 'text-brand' },
  validated: { label: 'Validated', icon: CheckCircle2, color: 'text-status-green' },
  input_required: { label: 'Input required', icon: AlertTriangle, color: 'text-status-amber' },
  under_review: { label: 'Under review', icon: RotateCw, color: 'text-brand' },
}

export default function SectionsTable({ sections, onOpenInputs, onOpenBom }) {
  const [filter, setFilter] = useState('all')
  const filtered = filter === 'all' ? sections : sections.filter((s) => s.status === filter)

  const categories = [...new Set(filtered.map((s) => s.category))]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`h-8 rounded-lg border px-3 text-xs font-medium ${
              filter === f.id ? 'border-brand bg-brand text-white' : 'border-border text-text hover:border-brand/40'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-max text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-text-secondary">
              {['#', 'Section', 'Generated from', 'Status', 'Completeness', 'Action'].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <CategoryRows key={cat} category={cat} sections={filtered.filter((s) => s.category === cat)} onOpenInputs={onOpenInputs} onOpenBom={onOpenBom} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CategoryRows({ category, sections, onOpenInputs, onOpenBom }) {
  return (
    <>
      <tr className="border-b border-border bg-brand/5">
        <td colSpan={6} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
          {category}
        </td>
      </tr>
      {sections.map((s) => {
        const meta = STATUS_META[s.status]
        const Icon = meta.icon
        return (
          <tr key={s.id} className="border-b border-border/60 last:border-0">
            <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{s.n}</td>
            <td className="px-3 py-1.5 font-medium text-text">{s.name}</td>
            <td className="px-3 py-1.5 text-text-secondary">{s.generatedFrom}</td>
            <td className="whitespace-nowrap px-3 py-1.5">
              <span className={`flex items-center gap-1.5 font-medium ${meta.color}`}>
                <Icon size={13} strokeWidth={2} />
                {meta.label}
              </span>
            </td>
            <td className="whitespace-nowrap px-3 py-1.5">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted">
                  <div className={`h-full ${s.completeness === 100 ? 'bg-status-green' : 'bg-brand'}`} style={{ width: `${s.completeness}%` }} />
                </div>
                <span className="text-text-secondary">{s.completeness}%</span>
              </div>
            </td>
            <td className="whitespace-nowrap px-3 py-1.5">
              {s.inputGroup ? (
                <button type="button" onClick={() => onOpenInputs(s.inputGroup)} className="rounded border border-border px-2 py-1 text-[11px] font-medium text-brand hover:border-brand">
                  Resolve
                </button>
              ) : s.id === 'bom' ? (
                <button type="button" onClick={onOpenBom} className="rounded border border-border px-2 py-1 text-[11px] font-medium text-brand hover:border-brand">
                  Review
                </button>
              ) : (
                <span className="text-[11px] text-text-secondary">View</span>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}
