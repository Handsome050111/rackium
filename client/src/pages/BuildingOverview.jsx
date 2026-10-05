import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import KpiStrip from '../components/KpiStrip.jsx'
import PhaseCard from '../components/PhaseCard.jsx'
import Stepper from '../components/Stepper.jsx'
import RecentHistoryPanel from '../components/RecentHistoryPanel.jsx'
import { getBuilding, getPhaseCards, getBuildingKpis, getRecentHistory } from '../api/index.js'
import { formatDateTime } from '@rackium/shared/time.js'

export default function BuildingOverview() {
  const { buildingId } = useParams()
  const [data, setData] = useState(null)

  useEffect(() => {
    let active = true
    setData(null)
    Promise.all([
      getBuilding(buildingId),
      getPhaseCards(buildingId),
      getBuildingKpis(buildingId),
      getRecentHistory(buildingId),
    ]).then(([building, phases, kpis, history]) => {
      if (active) setData({ building, phases, kpis, history })
    })
    return () => {
      active = false
    }
  }, [buildingId])

  if (!data) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const { building, phases, kpis, history } = data

  const kpiItems = [
    { label: 'Overall progress', value: `${kpis.overallProgress}%`, progress: kpis.overallProgress },
    { label: 'Current phase', value: kpis.currentPhase },
    { label: 'Open blockers', value: kpis.openBlockers },
    { label: 'Approval awaiting action', value: kpis.approvalsAwaitingAction },
    { label: 'Last synchronisation', value: formatDateTime(kpis.lastSyncAt) },
  ]

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <Breadcrumb items={building.breadcrumb} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">{building.name}</h1>
          <p className="text-sm text-text-secondary">One building · one connected project record</p>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <Building2 size={28} strokeWidth={1.5} className="text-brand" />
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-text-secondary">Project</dt>
            <dd className="font-medium text-text">{building.project.code}</dd>
            <dt className="text-text-secondary">Country</dt>
            <dd className="font-medium text-text">{building.project.country}</dd>
            <dt className="text-text-secondary">SAL code</dt>
            <dd className="font-medium text-text">{building.project.sal}</dd>
            <dt className="text-text-secondary">Campus</dt>
            <dd className="font-medium text-text">{building.project.campus}</dd>
            <dt className="text-text-secondary">Building</dt>
            <dd className="font-medium text-text">{building.project.building}</dd>
          </dl>
        </div>
      </div>

      <KpiStrip items={kpiItems} nextMilestone={kpis.nextMilestone} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {phases.map((phase) => (
          <PhaseCard key={phase.id} buildingId={buildingId} phase={phase} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-text">Project continuity</h2>
          <Stepper phases={phases} />
        </div>
        <RecentHistoryPanel items={history} />
      </div>
    </div>
  )
}
