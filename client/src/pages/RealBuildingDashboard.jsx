import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAuth } from '../lib/AuthContext.jsx'
import { useViewAs } from '../lib/ViewAsContext.jsx'
import { dashboardApi } from '../api/dashboardApi.js'
import { blockersApi } from '../api/blockersApi.js'
import KpiStrip from '../components/KpiStrip.jsx'
import PhaseCard from '../components/PhaseCard.jsx'
import RecentHistoryPanel from '../components/RecentHistoryPanel.jsx'

const PHASE_META = {
  cmo: { name: 'CMO Inventory Validation', icon: 'ClipboardCheck' },
  survey: { name: 'Physical Site Survey', icon: 'HardHat' },
  hld: { name: 'HLD', icon: 'Network' },
  lld: { name: 'LLD', icon: 'FileText' },
  'solution-package': { name: 'Solution Package', icon: 'FileCheck2' },
  bom: { name: 'BOM', icon: 'Database' },
  deployment: { name: 'Deployment & Installation', icon: 'Wrench' },
  cmdb: { name: 'CMDB', icon: 'Server' },
  handover: { name: 'Handover', icon: 'PackageCheck' },
}

const PRIORITY_CLASS = { low: 'text-status-grey', medium: 'text-status-amber', high: 'text-status-red', critical: 'text-status-red' }

export default function RealBuildingDashboard() {
  const { orgId, projectId, buildingId } = useParams()
  const { memberships, user } = useAuth()
  const { session: viewAsSession } = useViewAs()
  const isPm = memberships.some((m) => m.level === 'project' && String(m.projectId) === String(projectId) && m.role === 'pm')
  const [data, setData] = useState(null)
  const [newBlocker, setNewBlocker] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!orgId) return
    dashboardApi.getBuildingDashboard(orgId, projectId, buildingId).then(setData)
  }, [orgId, projectId, buildingId])

  useEffect(() => {
    load()
  }, [load])

  if (!data) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  const { building, phases, kpis, blockers, recentActivity } = data
  const readOnly = Boolean(viewAsSession)

  async function raiseBlocker() {
    if (!newBlocker.trim() || !phases[0]) return
    setBusy(true)
    try {
      await blockersApi.raise(orgId, projectId, { buildingId, phaseKey: phases[0].phaseKey, description: newBlocker.trim() })
      setNewBlocker('')
      load()
    } finally {
      setBusy(false)
    }
  }

  async function resolveBlocker(id) {
    setBusy(true)
    try {
      await blockersApi.update(orgId, projectId, id, { status: 'resolved' })
      load()
    } finally {
      setBusy(false)
    }
  }

  async function assignToMe(id) {
    setBusy(true)
    try {
      await blockersApi.update(orgId, projectId, id, { ownerId: user.id })
      load()
    } finally {
      setBusy(false)
    }
  }

  const kpiItems = [
    { label: 'Devices', value: kpis.devices },
    { label: 'Connections', value: kpis.connections },
    { label: 'Open issues', value: kpis.openIssues },
    { label: 'Completion', value: `${kpis.completionPercent}%`, progress: kpis.completionPercent },
  ]

  const historyItems = recentActivity.map((e) => ({
    id: e.id,
    label: `${e.actor.role ?? e.actor.type} · ${e.action}`,
    at: e.occurredAt,
  }))

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-text">{building.name}</h1>
        <p className="text-sm text-text-secondary">{building.code}</p>
      </div>

      <KpiStrip items={kpiItems} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {phases.map((entry) => {
          const meta = PHASE_META[entry.phaseKey]
          if (!meta) return null
          return (
            <PhaseCard
              key={entry.phaseKey}
              buildingId={buildingId}
              phase={{ id: entry.phaseKey, name: meta.name, icon: meta.icon, status: entry.status, subLabel: entry.subLabel }}
              to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}/${entry.phaseKey}`}
            />
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">Open blockers</h2>
          {!readOnly && (
            <div className="flex gap-2">
              <input
                className="h-9 flex-1 rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                placeholder="Describe the blocker"
                value={newBlocker}
                onChange={(e) => setNewBlocker(e.target.value)}
              />
              <button type="button" disabled={busy} onClick={raiseBlocker} className="flex h-9 items-center gap-1 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 disabled:bg-status-grey">
                <Plus size={14} strokeWidth={2} />
                Raise
              </button>
            </div>
          )}
          {blockers.length === 0 ? (
            <p className="text-xs text-text-secondary">No blockers raised.</p>
          ) : (
            <ul className="space-y-2">
              {blockers.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className={`mr-1.5 text-xs font-semibold uppercase ${PRIORITY_CLASS[b.priority]}`}>{b.priority}</span>
                    <span className="text-text">{b.description}</span>
                  </span>
                  {b.status !== 'resolved' && !readOnly && (
                    <span className="flex shrink-0 gap-1.5 text-xs">
                      {!b.ownerId && isPm && (
                        <button type="button" disabled={busy} onClick={() => assignToMe(b.id)} className="font-medium text-brand hover:underline">
                          Assign to me
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => resolveBlocker(b.id)} className="font-medium text-status-green hover:underline">
                        Resolve
                      </button>
                    </span>
                  )}
                  {b.status === 'resolved' && <span className="shrink-0 text-xs text-status-green">Resolved</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <RecentHistoryPanel items={historyItems} activityTo={null} />
      </div>
    </div>
  )
}
