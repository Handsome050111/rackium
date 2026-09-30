import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FileText, ArrowRight } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import { getBuilding } from '../api/index.js'
import { getBuildingRackTree } from '../api/lld.js'

export default function LldLanding() {
  const { buildingId } = useParams()
  const navigate = useNavigate()
  const [building, setBuilding] = useState(null)
  const [tree, setTree] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([getBuilding(buildingId), getBuildingRackTree()]).then(([b, t]) => {
      if (active) {
        setBuilding(b)
        setTree(t)
      }
    })
    return () => {
      active = false
    }
  }, [buildingId])

  if (!building || !tree) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <Breadcrumb items={[...building.breadcrumb, { label: 'LLD' }]} />

      <div>
        <h1 className="text-2xl font-bold text-text">LLD</h1>
        <p className="text-sm text-text-secondary">
          Low-Level Design derives from the latest approved HLD. Full topology views arrive in a later step —
          for now, open a rack in the Rackium Editor to map ports.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
          <FileText size={16} strokeWidth={2} className="text-brand" />
          Racks in {building.code}
        </div>
        <div className="space-y-4">
          {tree.map((floor) => (
            <div key={floor.id}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {floor.name}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {floor.rooms.flatMap((room) =>
                  room.racks.map((rack) => (
                    <button
                      key={rack.id}
                      type="button"
                      onClick={() => navigate(`/b/${buildingId}/lld/editor?rack=${rack.id}`)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-left hover:border-brand/40 hover:shadow-sm"
                    >
                      <div>
                        <div className="text-sm font-medium text-text">
                          {room.code} · Rack {rack.code}
                        </div>
                        <div className="text-xs text-text-secondary">{rack.heightU}U · Open in Rackium Editor</div>
                      </div>
                      <ArrowRight size={16} className="shrink-0 text-brand" />
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
