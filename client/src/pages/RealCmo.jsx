import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, Upload, Server, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react'
import { ACTIONS } from '@rackium/shared/policy.js'
import { applyColumnMapping } from '@rackium/shared/cmoModel.js'
import CmoImportWizard from '../components/cmo/CmoImportWizard.jsx'
import UnassignedList from '../components/cmo/UnassignedList.jsx'
import CmoDeviceTable from '../components/cmo/CmoDeviceTable.jsx'
import StatusChip from '../components/StatusChip.jsx'
import { parseCmoFile, downloadCmoTemplate } from '../api/cmoDesign.js'
import { cmoApi } from '../api/cmoApi.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { useViewAs } from '../lib/ViewAsContext.jsx'
import { canIn } from '../lib/realRoles.js'

function Kpi({ icon: Icon, value, label, tone = 'text-brand' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Icon size={18} strokeWidth={2} className={`shrink-0 ${tone}`} />
      <div>
        <div className="text-lg font-bold leading-tight text-text">{value}</div>
        <div className="text-[11px] text-text-secondary">{label}</div>
      </div>
    </div>
  )
}

// Real-mode CMO Inventory Validation (brief v2.3 §5.1, M3a). Reuses the
// prototype's wizard, device table and Unassigned list; preview and commit
// run on the backend against the project's serial registry, and the PM
// assigns Unassigned devices per SAL.
export default function RealCmo() {
  const { orgId, projectId, buildingId } = useParams()
  const { memberships } = useAuth()
  const { session: viewAsSession } = useViewAs()
  const readOnly = Boolean(viewAsSession)
  const [context, setContext] = useState(null)
  const [error, setError] = useState(null)
  const [importing, setImporting] = useState(false)
  // The SAL Unassigned rows land in: the user's pick, else this building's own SAL.
  const [pickedSalId, setSalId] = useState('')
  const [lastResult, setLastResult] = useState(null)

  const canImport = !readOnly && canIn(memberships, orgId, projectId, ACTIONS.IMPORT_CMO)
  const canAssign = !readOnly && canIn(memberships, orgId, projectId, ACTIONS.ASSIGN_CMO_DEVICE)

  const load = useCallback(() => {
    cmoApi
      .context(orgId, projectId)
      .then((ctx) => {
        setContext(ctx)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }, [orgId, projectId])

  useEffect(() => {
    load()
  }, [load])

  const building = context?.buildings.find((b) => b.id === buildingId) ?? null

  // Only a SAL the caller's scope covers (a building-scoped user has none:
  // rows without a building are then refused per row by the server).
  const salId = pickedSalId || (context?.sals.some((s) => s.id === building?.salId) ? building.salId : '')

  const unassignedBySal = useMemo(() => {
    if (!context) return []
    return context.sals
      .map((sal) => ({ sal, devices: context.devices.filter((d) => !d.buildingId && d.salId === sal.id), buildings: context.buildings.filter((b) => b.salId === sal.id) }))
      .filter((group) => group.devices.length > 0 || group.sal.id === building?.salId)
  }, [context, building])

  if (error) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!context) return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  if (!building) return <div className="p-6 text-sm text-text-secondary">This building is not in the project.</div>

  const buildingDevices = context.devices.filter((d) => d.buildingId === buildingId)
  const salDevices = context.devices.filter((d) => d.salId === building.salId)

  async function handleAssign(deviceId, targetBuildingId) {
    try {
      await cmoApi.assign(orgId, projectId, deviceId, targetBuildingId)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const salPicker =
    context.sals.length > 1 ? (
      <label className="block max-w-xs space-y-1">
        <span className="text-xs text-text-secondary">SAL for devices without a known building (Unassigned)</span>
        <select
          value={salId}
          onChange={(e) => setSalId(e.target.value)}
          className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs text-text focus:border-brand focus:outline-none"
        >
          {context.sals.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code}
            </option>
          ))}
        </select>
      </label>
    ) : null

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      <Link to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        {building.code} dashboard
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-text">CMO Inventory Validation</h1>
            <StatusChip status={building.cmoStatus} />
          </div>
          <p className="text-sm text-text-secondary">
            Existing-inventory baseline for {building.name} · SAL {building.salCode ?? '—'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={downloadCmoTemplate}
            className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand sm:h-9"
          >
            <Download size={14} strokeWidth={2} />
            Download template
          </button>
          {canImport && !importing && (
            <button
              type="button"
              onClick={() => {
                setLastResult(null)
                setImporting(true)
              }}
              className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 sm:h-9"
            >
              <Upload size={14} strokeWidth={2} />
              Import CMO Inventory
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={Server} value={salDevices.length} label={`Devices imported (SAL ${building.salCode ?? ''})`} />
        <Kpi icon={Server} value={buildingDevices.length} label={`In ${building.code}`} />
        <Kpi icon={CheckCircle2} value={context.kpis.assigned} label="Assigned (project)" tone="text-status-green" />
        <Kpi icon={AlertTriangle} value={context.kpis.unassigned} label="Unassigned (project)" tone={context.kpis.unassigned > 0 ? 'text-status-red' : 'text-status-green'} />
      </div>

      {lastResult && (
        <p role="status" className="rounded-lg border border-status-green/30 bg-status-green/5 px-3 py-2 text-xs text-status-green">
          Imported {lastResult.summary.imported} device(s): {lastResult.summary.assigned} assigned, {lastResult.summary.unassigned} Unassigned
          {lastResult.summary.skipped > 0 ? `, ${lastResult.summary.skipped} blocked row(s) skipped` : ''}.
        </p>
      )}

      {importing ? (
        <CmoImportWizard
          parseFile={parseCmoFile}
          preview={async (rawRows, mapping) => (await cmoApi.preview(orgId, projectId, { rows: applyColumnMapping(rawRows, mapping), salId: salId || undefined })).rows}
          commit={(rows, { fileName }) => cmoApi.commit(orgId, projectId, { rows, salId: salId || undefined, fileName })}
          mapControls={salPicker}
          showWarnings
          onCancel={() => setImporting(false)}
          onImported={(result) => {
            setImporting(false)
            setLastResult(result)
            load()
          }}
        />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-sm font-semibold text-text">{building.name} — CMO devices</div>
            <CmoDeviceTable devices={buildingDevices} />
          </div>
          {unassignedBySal.map(({ sal, devices, buildings }) => (
            <UnassignedList
              key={sal.id}
              title={`Unassigned at SAL ${sal.code}`}
              devices={devices}
              buildings={buildings}
              editable={canAssign}
              onAssign={handleAssign}
            />
          ))}
        </div>
      )}
    </div>
  )
}
