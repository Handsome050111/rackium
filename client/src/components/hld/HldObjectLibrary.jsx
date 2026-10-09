import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Search } from 'lucide-react'
import { HLD_LIBRARY_CATEGORIES } from '../../mock/hldLibrary.js'
import { mediaColors } from '../../tokens/design-tokens.js'
import TopologyIcon from '../TopologyIcon.jsx'

function DraggableLibraryItem({ item, enabled }) {
  const draggable = enabled && !item.comingSoon
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `hld-library:${item.id}`,
    data: { kind: 'hld-library-item', item },
    disabled: !draggable,
  })

  const title = item.comingSoon ? 'Available in a later milestone' : enabled ? 'Drag onto the canvas' : 'View-only'

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      title={title}
      className={`flex touch-none select-none items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs [-webkit-touch-callout:none] ${
        draggable ? 'cursor-grab bg-surface hover:border-brand/40 active:cursor-grabbing' : 'cursor-not-allowed bg-surface-muted opacity-50'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      <TopologyIcon role={item.icon} size={16} className="text-brand" />
      <span className="font-medium text-text">{item.label}</span>
    </div>
  )
}

const LEGEND_ITEMS = [
  { key: 'os2', label: 'SM fibre (OS2)' },
  { key: 'om4', label: 'MM fibre (OM4)' },
  { key: 'cat6a', label: 'Cat6A' },
  { key: 'stack', label: 'Stack cable' },
]

// `categories`: real mode passes its own (every role enabled, from the backend).
export default function HldObjectLibrary({ enabled, categories: source = HLD_LIBRARY_CATEGORIES }) {
  const [query, setQuery] = useState('')
  const categories = source.map((category) => ({
    ...category,
    items: category.items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
  })).filter((category) => category.items.length > 0)

  return (
    <div className="w-full shrink-0 space-y-3 rounded-xl border border-border bg-surface p-3 sm:w-64">
      <div className="px-1 text-sm font-semibold text-text">HLD object library</div>

      <div className="relative">
        <Search size={14} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search objects…"
          className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-xs text-text focus:border-brand focus:outline-none"
        />
      </div>

      {categories.map((category) => (
        <div key={category.key}>
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{category.label}</div>
          <div className="space-y-1.5">
            {category.items.map((item) => (
              <DraggableLibraryItem key={item.id} item={item} enabled={enabled} />
            ))}
          </div>
        </div>
      ))}

      <div>
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Connections</div>
        <div className="space-y-1">
          {LEGEND_ITEMS.map((l) => (
            <div key={l.key} className="flex items-center gap-2 px-1 text-xs text-text">
              <span className="h-0.5 w-5 rounded" style={{ backgroundColor: mediaColors[l.key].stroke }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
