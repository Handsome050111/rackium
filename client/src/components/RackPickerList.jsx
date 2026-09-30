import { ArrowRight } from 'lucide-react'

export default function RackPickerList({ tree, actionLabel, onOpenRack }) {
  return (
    <div className="space-y-4">
      {tree.map((floor) => (
        <div key={floor.id}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">{floor.name}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {floor.rooms.flatMap((room) =>
              room.racks.map((rack) => (
                <button
                  key={rack.id}
                  type="button"
                  onClick={() => onOpenRack(rack.id)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-left hover:border-brand/40 hover:shadow-sm"
                >
                  <div>
                    <div className="text-sm font-medium text-text">
                      {room.code} · Rack {rack.code}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {rack.heightU}U · {actionLabel}
                    </div>
                  </div>
                  <ArrowRight size={16} className="shrink-0 text-brand" />
                </button>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
