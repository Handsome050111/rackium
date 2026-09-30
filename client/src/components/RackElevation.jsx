import { useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useMediaQuery } from '../lib/useMediaQuery.js'

const RU_PX = 20

const STATE_STYLE = {
  device: 'border-brand bg-brand/10 text-text',
  reserved: 'border-brand border-dashed bg-transparent text-brand',
  blocked: 'border-status-grey bg-surface-muted text-text-secondary',
}

const BLOCKED_HATCH = {
  backgroundImage:
    'repeating-linear-gradient(45deg, rgba(138,144,156,0.35) 0, rgba(138,144,156,0.35) 2px, transparent 2px, transparent 8px)',
}

function faceRuId(face, ru) {
  return `ru:${face}:${ru}`
}

function railId(face, side) {
  return `rail:${face}:${side}`
}

// Reverses faceRuId/railId — the one place that knows the droppable id
// format, so callers (e.g. the drag-end handler) never re-encode it.
export function parseDroppableId(id) {
  if (!id) return null
  const [type, face, ruOrSide] = id.split(':')
  if (type === 'ru') return { type: 'ru', face, ru: Number(ruOrSide) }
  if (type === 'rail') return { type: 'rail', face, side: ruOrSide }
  return null
}

function PlacementBlock({ placement, rackHeightU, draggable, isSelected, onSelect, dimmed, badge }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `placement:${placement.id}`,
    data: { kind: 'move-placement', placement },
    disabled: !draggable,
  })

  const topRu = placement.ru + placement.heightU - 1
  const top = (rackHeightU - topRu) * RU_PX
  const height = placement.heightU * RU_PX

  const style = {
    position: 'absolute',
    top,
    height,
    left: 2,
    right: 2,
    zIndex: isDragging ? 20 : isSelected ? 10 : 1,
    opacity: isDragging ? 0.35 : dimmed ? 0.4 : 1,
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    ...(placement.kind === 'blocked' ? BLOCKED_HATCH : undefined),
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={() => onSelect?.(placement)}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      // touch-none/select-none/webkit-touch-callout only when draggable — a
      // read-only/view-mode block must stay scrollable and selectable under
      // touch, not just non-draggable. The callout/select suppression stops
      // iOS Safari's long-press copy/share menu from hijacking a touch drag.
      className={`flex items-center overflow-hidden rounded border px-1.5 text-left text-[11px] leading-tight ${
        STATE_STYLE[placement.kind] ?? STATE_STYLE.device
      } ${isSelected ? 'ring-2 ring-brand ring-offset-1' : ''} ${
        draggable
          ? 'cursor-grab touch-none select-none active:cursor-grabbing [-webkit-touch-callout:none]'
          : 'cursor-pointer'
      }`}
      title={placement.label}
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{placement.label}</span>
        {placement.sublabel && <span className="text-text-secondary"> · {placement.sublabel}</span>}
      </span>
      {badge && (
        <span className="ml-1 shrink-0 rounded bg-brand/15 px-1 text-[9px] font-semibold text-brand">{badge}</span>
      )}
    </button>
  )
}

function RuRow({ ru, face, editable, preview }) {
  const { setNodeRef, isOver } = useDroppable({ id: faceRuId(face, ru), data: { face, ru }, disabled: !editable })

  let tint = ''
  if (preview && preview.face === face && ru >= preview.ruStart && ru <= preview.ruEnd) {
    tint = preview.valid ? 'bg-status-green/15' : 'bg-status-red/15'
  } else if (isOver && editable) {
    tint = 'bg-brand/10'
  }

  return (
    <div
      ref={editable ? setNodeRef : undefined}
      className={`flex items-center border-b border-border/60 text-[9px] text-text-secondary ${tint}`}
      style={{ height: RU_PX }}
    >
      <span className="w-7 shrink-0 text-right pr-1 tabular-nums">{ru}</span>
    </div>
  )
}

function RailSlot({ face, side, items, editable }) {
  const { setNodeRef, isOver } = useDroppable({ id: railId(face, side), data: { face, side, rail: true }, disabled: !editable })
  return (
    <div
      ref={editable ? setNodeRef : undefined}
      className={`flex w-8 flex-col items-center gap-1 rounded border border-dashed border-border p-1 ${isOver ? 'bg-brand/10' : ''}`}
      title={`${side} rail (0U)`}
    >
      <span className="text-[8px] uppercase text-text-secondary">{side === 'left' ? 'L' : 'R'}</span>
      {items.map((item) => (
        <span
          key={item.id}
          title={item.label}
          className="w-full truncate rounded border border-brand bg-brand/10 px-0.5 text-center text-[8px] text-brand"
        >
          {item.label}
        </span>
      ))}
    </div>
  )
}

function FacePanel({ face, label, rack, placements, editable, selectedPlacementId, selectionBadges, onSelectPlacement, preview, permissionFor }) {
  const facePlacements = placements.filter((p) => p.mounting !== '0U' && (p.face === face || p.fullDepth || p.kind === 'blocked'))
  const railItems = placements.filter((p) => p.mounting === '0U' && p.face === face)
  const ruList = Array.from({ length: rack.heightU }, (_, i) => rack.heightU - i)

  return (
    <div>
      <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="flex gap-1.5">
        {face === 'rear' && (
          <RailSlot face={face} side="left" items={railItems.filter((p) => p.railSide === 'left')} editable={editable} />
        )}
        <div className="relative flex-1 rounded-md border-2 border-border bg-surface" style={{ width: 220 }}>
          {ruList.map((ru) => (
            <RuRow key={ru} ru={ru} face={face} editable={editable} preview={preview} />
          ))}
          {facePlacements.map((p) => (
            <PlacementBlock
              key={p.id}
              placement={p}
              rackHeightU={rack.heightU}
              draggable={editable && permissionFor(p)}
              isSelected={p.id === selectedPlacementId || Boolean(selectionBadges?.[p.id])}
              onSelect={onSelectPlacement}
              dimmed={false}
              badge={selectionBadges?.[p.id]}
            />
          ))}
        </div>
        {face === 'rear' && (
          <RailSlot face={face} side="right" items={railItems.filter((p) => p.railSide === 'right')} editable={editable} />
        )}
      </div>
    </div>
  )
}

export default function RackElevation({
  rack,
  placements,
  mode = 'view', // 'view' | 'edit'
  selectedPlacementId,
  selectionBadges, // { [placementId]: 'SRC' | 'DST' | ... } — for multi-item selection contexts
  onSelectPlacement,
  permissionFor = () => true, // (placement) => boolean, e.g. gate device vs reserved vs blocked drag
  dropPreview = null, // { face, ruStart, ruEnd, valid }
  freeRuByFace, // { front: {availableRU, contiguousFreeRU}, rear: {...} } — pre-computed by the caller
}) {
  const isWideEnoughForBothFaces = useMediaQuery('(min-width: 1024px)')
  const [activeFace, setActiveFace] = useState('front')
  const editable = mode === 'edit'

  const showFaces = isWideEnoughForBothFaces ? ['front', 'rear'] : [activeFace]

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-text">
          Rack {rack.code} — {rack.heightU}U
        </span>
        {!isWideEnoughForBothFaces && (
          <div className="flex rounded-lg border border-border p-0.5 text-xs">
            {['front', 'rear'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setActiveFace(f)}
                className={`rounded px-2.5 py-1 font-medium capitalize ${
                  activeFace === f ? 'bg-brand text-white' : 'text-text-secondary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-center gap-6 overflow-x-auto">
        {showFaces.map((face) => (
          <FacePanel
            key={face}
            face={face}
            label={face}
            rack={rack}
            placements={placements}
            editable={editable}
            selectedPlacementId={selectedPlacementId}
            selectionBadges={selectionBadges}
            onSelectPlacement={onSelectPlacement}
            preview={dropPreview}
            permissionFor={permissionFor}
          />
        ))}
      </div>

      {freeRuByFace && (
        <div className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-text-secondary">
          {Object.entries(freeRuByFace).map(([face, totals]) => (
            <span key={face} className="capitalize">
              {face}: {totals.availableRU} free RU ({totals.contiguousFreeRU} contiguous) ·{' '}
              {rack.heightU - totals.availableRU} used
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export { faceRuId, railId, RU_PX }
