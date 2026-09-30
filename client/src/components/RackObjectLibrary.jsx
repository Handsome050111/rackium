import { useDraggable } from '@dnd-kit/core'
import { RACK_LIBRARY_ICONS } from '../lib/rackLibraryIcons.js'
import { RACK_LIBRARY_ITEMS, RACK_STATE_TOOLS } from '../mock/rackLibrary.js'

function LibraryItem({ item, enabled, disabledReason }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library:${item.id}`,
    data: { kind: 'library-item', item },
    disabled: !enabled,
  })
  const Icon = RACK_LIBRARY_ICONS[item.icon] ?? RACK_LIBRARY_ICONS.Package

  return (
    <div
      ref={setNodeRef}
      {...(enabled ? { ...listeners, ...attributes } : {})}
      title={enabled ? `Drag onto the rack — ${item.heightU}U` : disabledReason}
      className={`flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs ${
        enabled ? 'cursor-grab bg-surface hover:border-brand/40 active:cursor-grabbing' : 'cursor-not-allowed bg-surface-muted opacity-50'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      <Icon size={16} strokeWidth={2} className="shrink-0 text-brand" />
      <span className="min-w-0 flex-1 truncate font-medium text-text">{item.label}</span>
      <span className="shrink-0 text-[10px] text-text-secondary">{item.heightU === 0 ? '0U' : `${item.heightU}U`}</span>
    </div>
  )
}

export default function RackObjectLibrary({ permissions }) {
  const categories = [...new Set(RACK_LIBRARY_ITEMS.map((i) => i.category))]

  return (
    <div className="w-full shrink-0 space-y-4 rounded-xl border border-border bg-surface p-3 sm:w-64">
      <div className="px-1 text-sm font-semibold text-text">Rack object library</div>

      <div className="space-y-3">
        {categories.map((category) => (
          <div key={category}>
            <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              {category}
            </div>
            <div className="space-y-1.5">
              {RACK_LIBRARY_ITEMS.filter((i) => i.category === category).map((item) => (
                <LibraryItem
                  key={item.id}
                  item={item}
                  enabled={permissions.canMoveDevices}
                  disabledReason="Only a Field Engineer can place equipment"
                />
              ))}
            </div>
          </div>
        ))}

        <div>
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">RU state</div>
          <div className="space-y-1.5">
            {RACK_STATE_TOOLS.map((tool) => {
              const enabled = tool.permission === 'canReserve' ? permissions.canReserve : permissions.canBlock
              const disabledReason =
                tool.permission === 'canReserve'
                  ? 'Only an Architect can reserve RU'
                  : 'Only a PM or Org Admin can block RU'
              return <LibraryItem key={tool.id} item={tool} enabled={enabled} disabledReason={disabledReason} />
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
