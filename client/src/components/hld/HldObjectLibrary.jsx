import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Server, Wifi, DoorOpen, Building2, Search } from 'lucide-react'
import { HLD_DEVICE_LIBRARY, HLD_REFERENCE_LIBRARY } from '../../mock/hldLibrary.js'
import { mediaColors } from '../../tokens/design-tokens.js'

const ICONS = { Server, Wifi, DoorOpen, Building2 }

function DraggableLibraryItem({ item, enabled }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `hld-library:${item.id}`,
    data: { kind: 'hld-library-item', item },
    disabled: !enabled,
  })
  const Icon = ICONS[item.icon] ?? Server

  return (
    <div
      ref={setNodeRef}
      {...(enabled ? { ...listeners, ...attributes } : {})}
      title={enabled ? 'Drag onto the canvas' : 'View-only'}
      className={`flex touch-none select-none items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs [-webkit-touch-callout:none] ${
        enabled ? 'cursor-grab bg-surface hover:border-brand/40 active:cursor-grabbing' : 'cursor-not-allowed bg-surface-muted opacity-50'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      <Icon size={16} strokeWidth={2} className="shrink-0 text-brand" />
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

export default function HldObjectLibrary({ enabled }) {
  const [query, setQuery] = useState('')
  const filteredDevices = HLD_DEVICE_LIBRARY.filter((d) => d.label.toLowerCase().includes(query.toLowerCase()))
  const filteredRefs = HLD_REFERENCE_LIBRARY.filter((d) => d.label.toLowerCase().includes(query.toLowerCase()))

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

      {filteredDevices.length > 0 && (
        <div>
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Network devices</div>
          <div className="space-y-1.5">
            {filteredDevices.map((item) => (
              <DraggableLibraryItem key={item.id} item={item} enabled={enabled} />
            ))}
          </div>
        </div>
      )}

      {filteredRefs.length > 0 && (
        <div>
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Reference</div>
          <div className="space-y-1.5">
            {filteredRefs.map((item) => (
              <DraggableLibraryItem key={item.id} item={item} enabled={enabled} />
            ))}
          </div>
        </div>
      )}

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
