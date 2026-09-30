import { Building2 } from 'lucide-react'

export default function RackContextPicker({ buildingName, tree, selectedRackId, onSelectRack }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold text-text">
        <Building2 size={16} strokeWidth={2} className="text-brand" />
        {buildingName}
      </div>

      <div className="space-y-4">
        {tree.map((floor) => (
          <div key={floor.id}>
            <div className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {floor.name}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {floor.rooms.map((room) => (
                <div key={room.id} className="rounded-lg border border-border p-2">
                  <div className="mb-1 text-xs font-semibold text-text">{room.code}</div>
                  <div className="space-y-1">
                    {room.racks.map((rack) => (
                      <button
                        key={rack.id}
                        type="button"
                        onClick={() => onSelectRack(rack.id)}
                        className={`flex h-touch w-full items-center justify-between rounded-md px-2 text-xs font-medium sm:h-7 ${
                          rack.id === selectedRackId
                            ? 'bg-brand/10 text-brand ring-1 ring-inset ring-brand/40'
                            : 'text-text-secondary hover:bg-surface-muted'
                        }`}
                      >
                        <span>Rack {rack.code}</span>
                        <span className="text-[10px]">{rack.heightU}U</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
