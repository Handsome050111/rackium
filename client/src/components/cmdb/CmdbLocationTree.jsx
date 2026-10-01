import { Building2, Server, Wifi, Video } from 'lucide-react'

const ROLE_ICON = { fusion: Server, border: Server, distribution: Server, edge: Server, ap: Wifi, probe: Video }

export default function CmdbLocationTree({ rows, buildingName, selectedId, onSelect }) {
  const byFloorRoom = new Map()
  for (const r of rows) {
    const key = `${r.floorName}||${r.roomCode}`
    if (!byFloorRoom.has(key)) byFloorRoom.set(key, { floorName: r.floorName, roomCode: r.roomCode, items: [] })
    byFloorRoom.get(key).items.push(r)
  }

  const floors = new Map()
  for (const group of byFloorRoom.values()) {
    if (!floors.has(group.floorName)) floors.set(group.floorName, [])
    floors.get(group.floorName).push(group)
  }

  return (
    <div className="space-y-1 rounded-xl border border-border bg-surface p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5 font-semibold text-text">
        <Building2 size={14} strokeWidth={2} className="text-brand" />
        {buildingName}
      </div>
      {[...floors.entries()].map(([floorName, rooms]) => (
        <div key={floorName} className="ml-1">
          <div className="py-0.5 font-medium text-text-secondary">{floorName}</div>
          {rooms.map((room) => (
            <div key={room.roomCode} className="ml-3">
              <div className="py-0.5 text-text-secondary">{room.roomCode}</div>
              {room.items.map((item) => {
                const Icon = ROLE_ICON[item.role] ?? Server
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={`ml-3 flex w-[calc(100%-0.75rem)] items-center gap-1.5 rounded px-1.5 py-1 text-left ${
                      selectedId === item.id ? 'bg-brand/10 text-brand' : 'text-text hover:bg-surface-muted'
                    }`}
                  >
                    <Icon size={12} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">{item.hostname}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
