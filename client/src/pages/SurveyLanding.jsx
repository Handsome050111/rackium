import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { HardHat } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import RackPickerList from '../components/RackPickerList.jsx'
import { getBuilding } from '../api/index.js'
import { getBuildingRackTree } from '../api/site.js'

export default function SurveyLanding() {
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
      <Breadcrumb items={[...building.breadcrumb, { label: 'Physical Site Survey' }]} />

      <div>
        <h1 className="text-2xl font-bold text-text">Physical Site Survey</h1>
        <p className="text-sm text-text-secondary">
          Site Structure, Room Details and Existing Connectivity arrive in a later step — for now, open a rack to
          capture its layout and installation readiness.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
          <HardHat size={16} strokeWidth={2} className="text-brand" />
          Racks in {building.code}
        </div>
        <RackPickerList
          tree={tree}
          actionLabel="Open Rack Survey"
          onOpenRack={(rackId) => navigate(`/b/${buildingId}/survey/rack?rack=${rackId}`)}
        />
      </div>
    </div>
  )
}
