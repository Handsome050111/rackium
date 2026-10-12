import { useNavigate, useParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import RackElevation from '../RackElevation.jsx'

// Every rack in the building, view-only — this is the Visio rack-diagram
// equivalent (brief v2.2 §3.7 Tab 2), but interactive and data-linked.
// Editing stays in the Rackium Editor, reached from here.
// `editorPath(rackId)` (real mode) replaces the prototype editor route;
// `renderExtra(entry)` adds real-mode controls under a rack.
export default function RackElevationsTab({ rackElevations, editorPath, renderExtra }) {
  const { buildingId } = useParams()
  const navigate = useNavigate()

  if (rackElevations.length === 0) {
    return <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-text-secondary">No racks surveyed yet.</div>
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {rackElevations.map((entry) => {
        const { rack, room, floorName, placements, freeRuByFace } = entry
        return (
        <div key={rack.id} className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="text-xs text-text-secondary">
              {floorName} · {room.code}
            </div>
            <button
              type="button"
              onClick={() => navigate(editorPath ? editorPath(rack.id) : `/b/${buildingId}/lld/editor?rack=${rack.id}`)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-brand hover:border-brand"
            >
              Open in Rackium Editor
              <ExternalLink size={13} strokeWidth={2} />
            </button>
          </div>
          <RackElevation rack={rack} placements={placements} mode="view" freeRuByFace={freeRuByFace} />
          {renderExtra?.(entry)}
        </div>
        )
      })}
    </div>
  )
}
