// A simplified rack visual for the Rackium Editor's context pane only.
// Step 3 formalizes the fully reusable RackElevation (front+rear, RU
// states, drag-drop) per the brief's build order (dashboard -> Editor ->
// rack elevation) — this component will be replaced by that one then.

function EntityRow({ entity, isSource, isDest, onSetSource, onSetDest, onClear, readOnly }) {
  const selected = isSource || isDest
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${
        selected ? 'border-brand shadow-[0_0_0_2px_rgba(9,79,154,0.15)]' : 'border-border'
      }`}
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-text">{entity.label}</div>
        <div className="truncate text-[10px] text-text-secondary">
          RU{entity.ru} · {entity.sublabel}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {selected ? (
          <button
            type="button"
            onClick={onClear}
            disabled={readOnly}
            title="Clear selection"
            className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSource ? 'SRC' : 'DST'} ×
          </button>
        ) : (
          !readOnly && (
            <>
              <button
                type="button"
                onClick={() => onSetSource(entity.id)}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-secondary hover:border-brand hover:text-brand"
              >
                Source
              </button>
              <button
                type="button"
                onClick={() => onSetDest(entity.id)}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-secondary hover:border-brand hover:text-brand"
              >
                Dest
              </button>
            </>
          )
        )}
      </div>
    </div>
  )
}

export default function MiniRackElevation({
  rack,
  entities,
  sourceEntityId,
  destEntityId,
  onSetSource,
  onSetDest,
  onClearSource,
  onClearDest,
  readOnly,
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 text-sm font-semibold text-text">
        Rack {rack.code} — {rack.heightU}U
      </div>
      <div className="space-y-1.5">
        {entities.map((entity) => (
          <EntityRow
            key={entity.id}
            entity={entity}
            isSource={entity.id === sourceEntityId}
            isDest={entity.id === destEntityId}
            onSetSource={onSetSource}
            onSetDest={onSetDest}
            onClear={entity.id === sourceEntityId ? onClearSource : onClearDest}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  )
}
