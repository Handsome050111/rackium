import { useDraggable } from '@dnd-kit/core'
import { DoorOpen, Server, Link2, Building2 } from 'lucide-react'
import { SITE_LIBRARY_ITEMS, SITE_INERT_TOOLS } from '../mock/siteLibrary.js'

const ICONS = { DoorOpen, Server, Building2 }

function DraggableTool({ item, enabled, disabledReason }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `site-library:${item.id}`,
    data: { kind: 'library-item', item },
    disabled: !enabled,
  })
  const Icon = ICONS[item.icon]

  return (
    <div
      ref={setNodeRef}
      {...(enabled ? { ...listeners, ...attributes } : {})}
      title={enabled ? `Drag onto the structure` : disabledReason}
      className={`flex touch-none select-none items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs [-webkit-touch-callout:none] ${
        enabled ? 'cursor-grab bg-surface hover:border-brand/40 active:cursor-grabbing' : 'cursor-not-allowed bg-surface-muted opacity-50'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      <Icon size={16} strokeWidth={2} className="shrink-0 text-brand" />
      <span className="font-medium text-text">{item.label}</span>
    </div>
  )
}

export default function SiteObjectLibrary({ permissions, connectMode, onToggleConnectMode }) {
  const enabled = permissions.canMoveDevices

  return (
    <div className="w-full shrink-0 space-y-3 rounded-xl border border-border bg-surface p-3 sm:w-64">
      <div className="px-1 text-sm font-semibold text-text">Survey object library</div>

      <div className="space-y-1.5">
        {SITE_LIBRARY_ITEMS.map((item) => (
          <DraggableTool
            key={item.id}
            item={item}
            enabled={enabled}
            disabledReason="Only a Field Engineer can build the structure"
          />
        ))}

        <button
          type="button"
          disabled={!enabled}
          onClick={() => onToggleConnectMode()}
          title={enabled ? 'Click two rooms to connect them' : 'Only a Field Engineer can add connections'}
          className={`flex h-touch w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-xs sm:h-auto ${
            !enabled
              ? 'cursor-not-allowed border-border bg-surface-muted opacity-50'
              : connectMode
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-surface hover:border-brand/40'
          }`}
        >
          <Link2 size={16} strokeWidth={2} className="shrink-0 text-brand" />
          <span className="font-medium text-text">{connectMode ? 'Click a room to connect…' : 'Building connection'}</span>
        </button>

        {SITE_INERT_TOOLS.map((item) => (
          <DraggableTool key={item.id} item={item} enabled={false} disabledReason={item.note} />
        ))}
      </div>
    </div>
  )
}
