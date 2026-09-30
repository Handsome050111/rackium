import { RACK_LIBRARY_ICONS } from '../lib/rackLibraryIcons.js'

// The floating "lift" visual shown in a DragOverlay while dragging — a
// library item being placed, or an existing placement being moved. Kept
// separate from the draggable source elements so the same lifted look is
// reusable wherever dnd-kit drag-and-drop shows up next.
export default function DragPreviewCard({ dragData }) {
  if (!dragData) return null

  const label = dragData.kind === 'library-item' ? dragData.item.label : dragData.placement.label
  const Icon = dragData.kind === 'library-item' ? RACK_LIBRARY_ICONS[dragData.item.icon] ?? RACK_LIBRARY_ICONS.Package : null

  return (
    <div className="flex scale-105 items-center gap-2 rounded-lg border border-brand bg-surface px-2.5 py-2 text-xs shadow-xl shadow-brand/30 ring-2 ring-brand/40">
      {Icon && <Icon size={16} strokeWidth={2} className="shrink-0 text-brand" />}
      <span className="font-medium text-text">{label}</span>
    </div>
  )
}
