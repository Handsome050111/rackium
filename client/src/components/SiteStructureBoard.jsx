import { useDroppable } from '@dnd-kit/core'
import { Building2, Plus, Server } from 'lucide-react'

function RackChip({ rack, onSelectRack }) {
  return (
    <button
      type="button"
      onClick={() => onSelectRack(rack)}
      title={`Rack ${rack.code} — open Rack Survey`}
      className="flex flex-col items-center gap-0.5 rounded-md border border-border px-2 py-1.5 text-[10px] text-text hover:border-brand/40"
    >
      <Server size={16} strokeWidth={2} className="text-brand" />
      {rack.code}
    </button>
  )
}

function RoomBox({ room, editable, connectMode, isConnectSource, isSelected, onSelectRoom, onAddRack, onSelectRack }) {
  const { setNodeRef, isOver } = useDroppable({ id: `site-room:${room.id}`, data: { kind: 'room', roomId: room.id }, disabled: !editable })

  return (
    <div
      ref={editable ? setNodeRef : undefined}
      onClick={() => onSelectRoom(room)}
      className={`flex min-w-[160px] cursor-pointer flex-col gap-2 rounded-lg border p-2.5 ${
        isConnectSource ? 'border-brand ring-2 ring-brand/30' : isSelected ? 'border-brand' : 'border-border'
      } ${isOver ? 'bg-brand/5' : 'bg-surface'} ${connectMode ? 'hover:border-brand' : ''}`}
    >
      <div className="text-xs font-semibold text-text">{room.code}</div>
      <div className="flex flex-wrap gap-1.5">
        {room.racks.map((rack) => (
          <RackChip key={rack.id} rack={rack} onSelectRack={onSelectRack} />
        ))}
        {editable && !connectMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAddRack(room.id)
            }}
            title="Add rack"
            className="flex h-touch w-touch items-center justify-center rounded-md border border-dashed border-border text-text-secondary hover:border-brand hover:text-brand sm:h-8 sm:w-8"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}

function FloorRow({ floor, editable, connectMode, connectFirstRoomId, selectedObjectRef, onSelectRoom, onAddRack, onSelectRack, onAddRoom }) {
  const { setNodeRef, isOver } = useDroppable({ id: `site-floor:${floor.id}`, data: { kind: 'floor', floorId: floor.id }, disabled: !editable })

  return (
    <div
      ref={editable ? setNodeRef : undefined}
      className={`rounded-lg border border-dashed p-3 ${isOver ? 'border-brand bg-brand/5' : 'border-border'}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-text">{floor.token}</span>
        {floor.rooms.length === 0 && editable && (
          <button
            type="button"
            onClick={() => onAddRoom(floor.id)}
            className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary hover:border-brand hover:text-brand sm:h-8"
          >
            <Plus size={14} strokeWidth={2} />
            Add communication room
          </button>
        )}
      </div>
      {floor.rooms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {floor.rooms.map((room) => (
            <RoomBox
              key={room.id}
              room={room}
              editable={editable}
              connectMode={connectMode}
              isConnectSource={connectFirstRoomId === room.id}
              isSelected={selectedObjectRef?.type === 'room' && selectedObjectRef.id === room.id}
              onSelectRoom={onSelectRoom}
              onAddRack={onAddRack}
              onSelectRack={onSelectRack}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SiteStructureBoard({
  buildingGroups,
  editable,
  connectMode,
  connectFirstRoomId,
  selectedObjectRef,
  onSelectRoom,
  onAddRack,
  onSelectRack,
  onAddRoom,
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {buildingGroups.map((building) => (
        <div key={building.buildingId} className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
            <Building2 size={18} strokeWidth={2} className="text-brand" />
            {building.buildingName}
          </div>
          <div className="space-y-3">
            {building.floors.map((floor) => (
              <FloorRow
                key={floor.id}
                floor={floor}
                editable={editable}
                connectMode={connectMode}
                connectFirstRoomId={connectFirstRoomId}
                selectedObjectRef={selectedObjectRef}
                onSelectRoom={onSelectRoom}
                onAddRack={onAddRack}
                onSelectRack={onSelectRack}
                onAddRoom={onAddRoom}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
