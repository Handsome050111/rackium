import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ReactFlowProvider } from '@xyflow/react'
import { ArrowLeft, Download, Sparkles, CheckCircle2, AlertTriangle, QrCode } from 'lucide-react'
import HldCanvas, { buildHldFlow } from '../components/hld/HldCanvas.jsx'
import ProvenanceBadge from '../components/realCmdb/ProvenanceBadge.jsx'
import RecordDetail from '../components/realCmdb/RecordDetail.jsx'
import CableMatrix from '../components/realCmdb/CableMatrix.jsx'
import PortTrace from '../components/realCmdb/PortTrace.jsx'
import ChangeLog from '../components/realCmdb/ChangeLog.jsx'
import LifecycleDashboard from '../components/realCmdb/LifecycleDashboard.jsx'
import { cmdbApi, cmdbRows, filterRecords } from '../api/deploymentApi.js'
import { exportCmdbXlsx } from '../lib/cmdbExport.js'
import DocumentExports from '../components/documents/DocumentExports.jsx'
import LabelPrintDialog from '../components/documents/LabelPrintDialog.jsx'
import { useProjectRoles } from '../lib/useProjectRoles.js'

const TABS = [
  { id: 'inventory', label: 'Asset inventory' },
  { id: 'map', label: 'Connection map' },
  { id: 'matrix', label: 'Cable matrix' },
  { id: 'ports', label: 'Port connectivity' },
  { id: 'log', label: 'Change log' },
  { id: 'lifecycle', label: 'Lifecycle' },
]
const DGUV_TONE = { valid: 'text-status-green', expiring_soon: 'text-status-amber', expiring: 'text-status-amber', overdue: 'text-status-red' }

function Row({ label, value, bad }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className={`text-right font-medium ${bad ? 'text-status-amber' : 'text-text'}`}>{value}</span>
    </div>
  )
}

function Reconciliation({ r }) {
  const clean = r.notInstalled === 0 && r.missingSerials.length === 0 && r.cableIdConflicts.length === 0 && r.openExceptions === 0
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-4" aria-label="Reconciliation" data-testid="reconciliation">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <Sparkles size={16} strokeWidth={2} className="text-brand" /> Reconciliation
      </div>
      <Row label="Design baseline (frozen LLD)" value={`${r.designCount} devices`} />
      <Row label="Installed" value={r.installedCount} bad={r.notInstalled > 0} />
      <Row label="In the CMDB (accepted)" value={r.cmdbCount} bad={r.cmdbCount < r.designCount} />
      <Row label="Missing serials" value={r.missingSerials.length ? r.missingSerials.map((m) => m.hostname).join(', ') : 0} bad={r.missingSerials.length > 0} />
      <Row label="Cable ID conflicts" value={r.cableIdConflicts.length ? r.cableIdConflicts.map((c) => c.cableId).join(', ') : 0} bad={r.cableIdConflicts.length > 0} />
      <Row label="Open exceptions" value={r.openExceptions} bad={r.openExceptions > 0} />
      <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${clean ? 'bg-status-green/10 text-status-green' : 'bg-status-amber/10 text-status-amber'}`}>
        {clean ? <CheckCircle2 size={14} strokeWidth={2} /> : <AlertTriangle size={14} strokeWidth={2} />}
        {clean ? 'As-built matches the design baseline' : 'Review required'}
      </div>
    </div>
  )
}

// Real-mode CMDB (brief v2.3 §5.8; client audit 9.1, 9.2; M6a): the as-built
// record from accepted deployment records only, in six views, with field
// provenance; Architects and PMs make operational edits.
export default function RealCmdb() {
  const { orgId, projectId, buildingId } = useParams()
  const [search, setSearch] = useSearchParams()
  const { readOnly } = useProjectRoles(orgId, projectId)
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [filters, setFilters] = useState({ q: '', status: '', roomCode: '' })
  const [labels, setLabels] = useState(false)
  const tab = TABS.some((t) => t.id === search.get('tab')) ? search.get('tab') : 'inventory'
  const selectedId = search.get('record')
  const selectedPort = search.get('port')
  const go = useCallback(
    (patch) =>
      setSearch((prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      }, { replace: true }),
    [setSearch]
  )

  const reload = useCallback(async () => {
    try {
      setView(await cmdbApi.view(orgId, projectId, buildingId))
      setError(null)
    } catch (err) {
      setError(err.status === 404 ? 'This building is not in the part of the project you can see.' : err.message)
    }
  }, [orgId, projectId, buildingId])
  useEffect(() => {
    reload()
  }, [reload])

  const placements = useMemo(() => {
    const out = new Map()
    if (!view) return out
    for (const r of view.records) out.set(r.id, { id: r.id, label: r.hostname ?? r.label, rackId: r.rackId, ru: r.ru, heightU: r.heightU ?? 1 })
    for (const p of view.panels ?? []) out.set(p.id, { ...p })
    for (const x of view.existingDevices ?? []) out.set(x.id, { id: x.id, label: x.hostname ?? x.label, rackId: x.rackId, ru: x.ru, heightU: x.heightU ?? 1 })
    return out
  }, [view])

  const flow = useMemo(() => {
    if (!view?.started) return null
    const devices = [...view.records.filter((r) => !r.passive), ...(view.existingDevices ?? []).map((x) => ({ ...x, status: 'in_service' }))].map((d) => ({ ...d, model: [d.model, d.rackCode].filter(Boolean).join(' · ') }))
    const ids = new Set(devices.map((d) => d.id))
    const connections = view.connections.filter((c) => ids.has(c.source.deviceId) && ids.has(c.dest.deviceId))
    return buildHldFlow({ floors: view.floors, rooms: view.rooms, devices, connections, connectionFindings: {}, selectedDeviceId: selectedId, onSelectDevice: (id) => go({ record: id }) })
  }, [view, selectedId, go])

  if (error && !view) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!view) return <div className="p-6 text-sm text-text-secondary" data-page-state="loading">Loading…</div>

  const canEdit = !readOnly && view.canEdit
  const nameOf = (id) => view.records.find((r) => r.id === id)?.hostname ?? view.retiredRecords?.find((r) => r.id === id)?.label ?? null
  const retired = view.retiredRecords ?? []
  const rooms = [...new Set(view.records.map((r) => r.roomCode).filter(Boolean))].sort()
  const shown = filterRecords(view.records, view.connections, filters)
  const selected = view.records.find((r) => r.id === selectedId) ?? null
  async function saveRecord(body) {
    try {
      await cmdbApi.edit(orgId, projectId, selected.id, body)
      setNotice('Operational change saved')
      setError(null)
      await reload()
      return true
    } catch (err) {
      setError(err.message)
      if (err.status === 409) await reload()
      return false
    }
  }

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6" data-page-state="ready">
      <Link to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        {view.building.code} dashboard
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text sm:text-2xl">CMDB — {view.building.code}</h1>
          <p className="text-sm text-text-secondary">The as-built record: devices and connections accepted in deployment, with where every value came from</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view.connections.length > 0 && (
            <button type="button" onClick={() => setLabels(true)} className="inline-flex h-touch items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text hover:border-brand sm:h-9">
              <QrCode size={15} strokeWidth={2} /> Print labels
            </button>
          )}
          <DocumentExports
            orgId={orgId}
            projectId={projectId}
            buildingId={buildingId}
            items={[
              { typeKey: 'cmdb-extract', format: 'pdf', label: 'CMDB extract' },
              { typeKey: 'cmdb-extract', format: 'csv', label: 'CMDB extract' },
              { typeKey: 'cmdb-extract', format: 'json', label: 'CMDB extract' },
              { typeKey: 'dguv-report', format: 'pdf', label: 'DGUV report' },
              { typeKey: 'dguv-report', format: 'xlsx', label: 'DGUV report' },
            ]}
          />
        </div>
      </div>
      {labels && (
        <LabelPrintDialog
          orgId={orgId}
          projectId={projectId}
          buildingId={buildingId}
          onClose={() => setLabels(false)}
          connections={view.connections.map((c) => ({ id: c.id, title: `${c.source.name} ${c.source.portId ?? ''} → ${c.dest.name} ${c.dest.portId ?? ''}`, cableIds: c.segments.map((s) => s.cableId).filter(Boolean) }))}
        />
      )}
      {notice && (
        <div className="rounded-xl border border-status-green/40 bg-status-green/5 px-4 py-2 text-sm text-status-green" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-status-red/40 bg-status-red/5 px-4 py-2 text-sm text-status-red" role="alert">
          {error}
        </div>
      )}

      <div role="tablist" aria-label="CMDB views" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => go({ tab: t.id })} className={`h-touch shrink-0 rounded-lg px-3 text-sm font-medium ${tab === t.id ? 'bg-brand/10 text-brand' : 'text-text-secondary hover:text-text'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {!view.started || (view.records.length === 0 && retired.length === 0) ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-text-secondary">No accepted devices yet — a device enters the CMDB when a PM or Reviewer accepts it in Deployment.</div>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            {tab === 'inventory' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search hostname, serial, MAC or cable ID…" aria-label="Search inventory" className="h-touch min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 text-sm focus:border-brand focus:outline-none sm:min-w-[220px]" />
                  <select aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="h-touch rounded-lg border border-border bg-surface px-2 text-sm">
                    <option value="">Status: All</option>
                    <option value="accepted">Accepted</option>
                    <option value="in_service">In service</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                  <select aria-label="Room" value={filters.roomCode} onChange={(e) => setFilters({ ...filters, roomCode: e.target.value })} className="h-touch rounded-lg border border-border bg-surface px-2 text-sm">
                    <option value="">Room: All</option>
                    {rooms.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => exportCmdbXlsx(cmdbRows(shown), `CMDB-${view.building.code}.xlsx`)} className="inline-flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-text">
                    <Download size={16} strokeWidth={2} /> Excel
                  </button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                  <table className="w-full min-w-max text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface-muted text-text-secondary">
                        {['Hostname', 'Role', 'Model', 'Room', 'Rack / RU', 'Serial', 'MAC', 'Status', 'DGUV'].map((h) => (
                          <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.id} onClick={() => go({ record: r.id })} className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-muted ${selectedId === r.id ? 'bg-brand/5' : ''}`}>
                          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-text">{r.hostname ?? r.label}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.roleLabel ?? r.category}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.model}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.roomCode}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.rackCode ? `${r.rackCode} / RU${r.ru ?? '—'}` : '—'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5">
                            <span className="inline-flex items-center gap-1 text-text">
                              {r.serial ?? '—'} {r.serial && <ProvenanceBadge provenance={r.provenance.serial} />}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-text-secondary">{r.mac ?? '—'}</td>
                          <td className={`whitespace-nowrap px-3 py-1.5 ${r.status === 'maintenance' ? 'text-status-amber' : 'text-status-green'}`}>{r.statusLabel}</td>
                          <td className={`whitespace-nowrap px-3 py-1.5 ${DGUV_TONE[r.dguv?.status] ?? 'text-text-secondary'}`}>{r.dguv ? r.dguv.label : 'n/a'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-text-secondary">
                  {shown.length} of {view.records.length} records
                </p>
              </div>
            )}
            {tab === 'map' && flow && (
              <ReactFlowProvider>
                <HldCanvas flow={flow} onInit={() => {}} />
              </ReactFlowProvider>
            )}
            {tab === 'matrix' && <CableMatrix rows={view.cableMatrix} onTrace={(deviceId, port) => go({ tab: 'ports', record: deviceId, port })} />}
            {tab === 'ports' &&
              (selected ? (
                <PortTrace record={selected} connections={view.connections} placements={placements} racks={view.racks} selectedPort={selectedPort} onSelectPort={(port) => go({ port })} />
              ) : (
                <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-sm text-text-secondary">Choose a device in the inventory, on the map or in the cable matrix.</p>
              ))}
            {tab === 'log' && (
              <div className="space-y-3">
                {retired.length > 0 && (
                  <div className="rounded-xl border border-border bg-surface p-4" aria-label="Retired records" role="region">
                    <h2 className="mb-2 text-sm font-semibold text-text">Retired records ({retired.length})</h2>
                    <ul className="space-y-1 text-xs text-text-secondary">
                      {retired.map((r) => (
                        <li key={r.id}>
                          <span className="font-medium text-text">{r.label}</span> — was {r.previousStatus}, removed by {r.reason} on {r.at ? new Date(r.at).toLocaleDateString() : '—'}
                          {r.serial ? `; serial ${r.serial} released` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <ChangeLog entries={view.changeLog} nameOf={nameOf} />
              </div>
            )}
            {tab === 'lifecycle' && (
              <LifecycleDashboard
                records={view.records}
                canEdit={canEdit}
                onSelect={(id) => go({ record: id })}
                onImport={async (body) => {
                  const result = await cmdbApi.importLifecycle(orgId, projectId, { buildingId, ...body })
                  if (body.apply) {
                    setNotice(`${result.applied} device(s) updated from ${body.fileName}`)
                    await reload()
                  }
                  return result
                }}
              />
            )}
          </div>
          <div className="w-full min-w-0 shrink-0 space-y-4 xl:w-[26rem]">
            {selected && <RecordDetail key={`${selected.id}:${selected.version}`} record={selected} canEdit={canEdit} onSave={saveRecord} onOpenPorts={() => go({ tab: 'ports' })} />}
            {view.reconciliation && <Reconciliation r={view.reconciliation} />}
          </div>
        </div>
      )}
    </div>
  )
}
