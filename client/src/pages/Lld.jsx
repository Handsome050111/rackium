import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, PlayCircle } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import ConnectivityTab from '../components/lld/ConnectivityTab.jsx'
import RackElevationsTab from '../components/lld/RackElevationsTab.jsx'
import PortScheduleTab from '../components/lld/PortScheduleTab.jsx'
import CableScheduleTab from '../components/lld/CableScheduleTab.jsx'
import HldBaselineBanner from '../components/lld/HldBaselineBanner.jsx'
import { getBuilding } from '../api/index.js'
import { getLldContext, rebaseLldToCurrentHld, assignCableId, assignMissingCableIds, setEngineerSelectedLength } from '../api/lldDesign.js'
import { isDesignFrozen, isHandoverAccepted } from '../api/designFreeze.js'
import { useRole } from '../lib/RoleContext.jsx'
import { canEditLld } from '../lib/permissions.js'
import { Lock } from 'lucide-react'

const TABS = [
  { id: 'connectivity', label: 'Connectivity' },
  { id: 'racks', label: 'Rack elevations' },
  { id: 'ports', label: 'Port schedule' },
  { id: 'cables', label: 'Cable schedule' },
]

export default function Lld() {
  const { buildingId } = useParams()
  const { role } = useRole()
  const [building, setBuilding] = useState(null)
  const [context, setContext] = useState(null)
  const [tab, setTab] = useState('connectivity')
  const [showValidation, setShowValidation] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [handoverAccepted, setHandoverAccepted] = useState(false)

  const reload = useCallback(() => {
    if (!buildingId) return
    Promise.all([getLldContext(buildingId), isDesignFrozen(buildingId), isHandoverAccepted(buildingId)]).then(([ctx, approved, accepted]) => {
      setContext(ctx)
      setFrozen(approved)
      setHandoverAccepted(accepted)
    })
  }, [buildingId])

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
  }, [buildingId])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleRebase() {
    await rebaseLldToCurrentHld(buildingId)
    reload()
  }

  async function handleAssignCableId(connectionId, rawId) {
    const result = await assignCableId(connectionId, rawId)
    if (result.ok) reload()
    return result
  }

  async function handleAssignAllMissing() {
    await assignMissingCableIds(buildingId)
    reload()
  }

  async function handleSetEngineerSelected(connectionId, meters) {
    const result = await setEngineerSelectedLength(connectionId, meters)
    if (result.ok) reload()
    return result
  }

  if (!building || !context) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const totalIssues = context.checks.portConflicts + context.checks.duplicateCableIds + context.checks.missingCableIds
  const editable = canEditLld(role)

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
      <Breadcrumb items={[...building.breadcrumb, { label: 'LLD' }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">LLD — Low-Level Design</h1>
          <p className="text-sm text-text-secondary">Building {building.code} · Exact port-to-port connections, rack elevations, cable specifications</p>
        </div>
        <button
          type="button"
          onClick={() => setShowValidation((v) => !v)}
          className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 sm:h-9"
        >
          <PlayCircle size={14} strokeWidth={2} />
          Validate LLD
        </button>
      </div>

      {frozen && (
        <div className="flex items-center gap-2 rounded-xl border border-status-green/40 bg-status-green/5 px-4 py-2.5 text-xs text-status-green">
          <Lock size={14} strokeWidth={2} />
          {handoverAccepted ? (
            <>
              <strong>Handover accepted</strong> — this building's design record is permanently read-only.
            </>
          ) : (
            <>
              <strong>Design frozen</strong> — the Solution Package is approved. LLD is read-only until a change request reopens it.
            </>
          )}
        </div>
      )}

      <HldBaselineBanner hld={context.hld} canEdit={editable && !frozen} onRebase={handleRebase} />

      {showValidation && (
        <div
          className={`flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-xs ${
            totalIssues === 0 ? 'border-status-green/40 bg-status-green/5 text-status-green' : 'border-status-amber/40 bg-status-amber/5 text-status-amber'
          }`}
        >
          {totalIssues === 0 ? <CheckCircle2 size={14} strokeWidth={2} /> : <AlertTriangle size={14} strokeWidth={2} />}
          {totalIssues === 0 ? (
            <span className="font-medium">All LLD validation checks pass.</span>
          ) : (
            <span>
              <strong>{context.checks.portConflicts}</strong> port conflict{context.checks.portConflicts === 1 ? '' : 's'} ·{' '}
              <strong>{context.checks.duplicateCableIds}</strong> duplicate Cable ID{context.checks.duplicateCableIds === 1 ? '' : 's'} ·{' '}
              <strong>{context.checks.missingCableIds}</strong> connection{context.checks.missingCableIds === 1 ? '' : 's'} missing a Cable ID
            </span>
          )}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-touch shrink-0 px-3 text-sm font-medium sm:h-9 ${
              tab === t.id ? 'border-b-2 border-brand text-brand' : 'text-text-secondary hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'connectivity' && <ConnectivityTab context={context} />}
      {tab === 'racks' && <RackElevationsTab rackElevations={context.rackElevations} />}
      {tab === 'ports' && <PortScheduleTab portSchedule={context.portSchedule} buildingCode={building.code} />}
      {tab === 'cables' && (
        <CableScheduleTab
          rows={context.rows}
          buildingCode={building.code}
          checks={context.checks}
          onAssignCableId={handleAssignCableId}
          onAssignAllMissing={handleAssignAllMissing}
          onSetEngineerSelected={handleSetEngineerSelected}
          frozen={frozen}
        />
      )}
    </div>
  )
}
