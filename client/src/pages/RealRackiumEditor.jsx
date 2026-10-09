import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, RefreshCw, Plus, Trash2, Lightbulb, Save } from 'lucide-react'
import RackElevation from '../components/RackElevation.jsx'
import PortFace from '../components/PortFace.jsx'
import { lldApi, portMapOf, portChoices, occupiedKeysOf } from '../api/lldApi.js'
import { portKey } from '@rackium/shared/lldDesign.js'
import { MEDIA_LABEL } from '@rackium/shared/lldModel.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { useProjectRoles } from '../lib/useProjectRoles.js'

const MEDIA = ['cat6a', 'om4', 'os2', 'dac', 'stack']
const SPEEDS = ['1G', '2.5G', '10G', '25G', '40G', '100G']
const inputClass = 'h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none disabled:bg-surface-muted disabled:text-text-secondary'
const EMPTY = { sourceDeviceId: '', sourcePort: null, destDeviceId: '', destPort: null, media: 'cat6a', speed: '1G', sourceSfpCode: null, destSfpCode: null, hops: [], cableId: '', engineerSelectedM: '' }

function toDraft(c) {
  return {
    sourceDeviceId: c.source.deviceId,
    sourcePort: c.source.portId,
    destDeviceId: c.dest.deviceId,
    destPort: c.dest.portId,
    media: c.media,
    speed: c.speed,
    sourceSfpCode: c.sourceSfpCode,
    destSfpCode: c.destSfpCode,
    hops: c.hops.map((h) => ({ patchPanelId: h.patchPanelId, inPort: h.inPort, outPort: h.outPort, segmentCableId: h.segmentCableId ?? '' })),
    cableId: c.cableId ?? '',
    engineerSelectedM: c.lengths.engineerSelectedM ?? '',
  }
}
function toBody(d) {
  const fibre = d.media === 'os2' || d.media === 'om4'
  return {
    source: { deviceId: d.sourceDeviceId, portId: d.sourcePort || null },
    dest: { deviceId: d.destDeviceId, portId: d.destPort || null },
    media: d.media,
    speed: d.speed,
    sourceSfpCode: fibre ? d.sourceSfpCode || null : null,
    destSfpCode: fibre ? d.destSfpCode || null : null,
    hops: d.hops.filter((h) => h.patchPanelId && h.inPort && h.outPort).map((h) => ({ patchPanelId: h.patchPanelId, inPort: h.inPort, outPort: h.outPort, segmentCableId: h.segmentCableId?.trim() || null })),
    cableId: d.cableId.trim() || null,
    engineerSelectedM: d.engineerSelectedM === '' ? null : Number(d.engineerSelectedM),
  }
}

// Rackium Editor — port mapping mode inside the LLD (brief §6.1–6.3; M4b).
// Exact port faces from the catalogue port map; source and destination port
// selection; patch-panel hops (in at the panel's rear, out at its front);
// the cable ID with the next free suggestion; Suggested and Engineer
// Selected lengths. Free compatible ports are suggested, never assigned:
// the user clicks "Use". The server's occupancy registry makes a double
// booking impossible, even between two people saving at once.
export default function RealRackiumEditor() {
  const { orgId, projectId, buildingId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const rackId = searchParams.get('rack') || ''
  const branchId = searchParams.get('branch') || null
  const connectionId = searchParams.get('connection') || null
  const { readOnly, has } = useProjectRoles(orgId, projectId)
  const isPhone = useMediaQuery('(max-width: 767px)')
  const [view, setView] = useState(null)
  const [draft, setDraft] = useState(EMPTY)
  const [error, setError] = useState(null)
  const [stale, setStale] = useState(null)
  const [saved, setSaved] = useState(null)

  const reload = useCallback(async () => {
    try {
      setView(await lldApi.view(orgId, projectId, buildingId, branchId))
      setError(null)
      setStale(null)
    } catch (err) {
      setError(err.message)
    }
  }, [orgId, projectId, buildingId, branchId])
  useEffect(() => {
    reload()
  }, [reload])

  const connection = view?.connections.find((c) => c.id === connectionId) ?? null
  // The draft follows the chosen connection (or a new one) when it changes.
  useEffect(() => {
    if (!view) return
    setDraft(connection ? toDraft(connection) : EMPTY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, view?.design.revision])

  const devices = useMemo(() => view?.devices ?? [], [view])
  const deviceById = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d])), [devices])
  const panels = devices.filter((d) => d.isPanel)
  const endDevices = devices.filter((d) => d.ports.length > 0)
  const rack = view?.racks.find((r) => r.id === rackId) ?? view?.racks[0] ?? null
  const inRack = new Set(devices.filter((d) => d.rackId === rack?.id).map((d) => d.id))
  const rackConnections = (view?.connections ?? []).filter((c) => inRack.has(c.source.deviceId) || inRack.has(c.dest.deviceId) || c.hops.some((h) => inRack.has(h.patchPanelId)))
  const editable = !readOnly && has('architect') && !isPhone && view?.design?.state !== 'awaiting_approval'
  const setParam = (patch) => {
    const next = Object.fromEntries([...searchParams.entries()])
    for (const [k, v] of Object.entries(patch)) if (v) next[k] = v
    else delete next[k]
    setSearchParams(next)
  }
  const patch = (p) => setDraft((d) => ({ ...d, ...p }))

  async function save() {
    try {
      const body = { ...toBody(draft), baseRevision: view.design.revision }
      if (connection) await lldApi.updateConnection(orgId, projectId, connection.id, body)
      else {
        const res = await lldApi.createConnection(orgId, projectId, { buildingId, branchId: branchId ?? undefined, ...body })
        setParam({ connection: res.connection.id })
      }
      setSaved('Saved')
      await reload()
    } catch (err) {
      setSaved(null)
      if (err.code === 'stale_revision') setStale(err.message)
      else setError(err.message)
    }
  }
  async function remove() {
    if (!connection || !window.confirm('Delete this connection? Its ports are released; its cable IDs are retired (never reused).')) return
    try {
      await lldApi.deleteConnection(orgId, projectId, connection.id, view.design.revision)
      setParam({ connection: null })
      await reload()
    } catch (err) {
      if (err.code === 'stale_revision') setStale(err.message)
      else setError(err.message)
    }
  }

  if (error && !view) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!view) return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  if (!view.started) return <div className="p-6 text-sm text-text-secondary">Start the LLD first.</div>

  const lldPath = `/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}/lld${branchId ? `?branch=${branchId}` : ''}`
  const opticsFor = view.optics.filter((o) => o.media === draft.media && String(o.speed) === String(draft.speed)).map((o) => o.key)
  const fibre = draft.media === 'os2' || draft.media === 'om4'

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
      <Link to={lldPath} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        Back to LLD
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-text">Rackium Editor</h1>
        <p className="text-sm text-text-secondary">
          Port mapping · Building {view.building.code}
          {view.branch ? ` · branch ${view.branch.name}` : ''} · revision {view.design.revision}
          {isPhone ? ' · view only on phone' : ''}
        </p>
      </div>

      {stale && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-status-amber/40 bg-status-amber/5 px-3 py-2 text-xs text-status-amber">
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={14} strokeWidth={2} />
            {stale}
          </span>
          <button type="button" onClick={reload} className="flex items-center gap-1 font-medium text-brand hover:underline">
            <RefreshCw size={12} strokeWidth={2} />
            Reload
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-status-red">
          {error}{' '}
          <button type="button" onClick={() => setError(null)} className="font-medium text-text-secondary underline">
            Dismiss
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-text-secondary">Rack</span>
            <select aria-label="Rack" value={rack?.id ?? ''} onChange={(e) => setParam({ rack: e.target.value, connection: null })} className={inputClass}>
              {view.racks.map((r) => (
                <option key={r.id} value={r.id}>
                  {view.rooms.find((x) => x.id === r.roomId)?.code} / {r.code}
                </option>
              ))}
            </select>
          </label>
          {rack && <RackElevation rack={rack} placements={rack.placements} mode="view" freeRuByFace={rack.freeRuByFace} compact />}
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-text">
              Connections in this rack
              {editable && (
                <button type="button" onClick={() => setParam({ connection: null })} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 font-medium text-brand hover:border-brand">
                  <Plus size={12} strokeWidth={2} />
                  New
                </button>
              )}
            </div>
            <ul className="space-y-1 text-xs" aria-label="Connections in this rack">
              {rackConnections.length === 0 && <li className="text-text-secondary">None yet.</li>}
              {rackConnections.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setParam({ connection: c.id })}
                    className={`w-full rounded-lg border px-2 py-1.5 text-left ${c.id === connectionId ? 'border-brand bg-brand/5' : 'border-border/60 hover:border-brand'}`}
                  >
                    <span className="font-medium text-text">{c.cableId ?? 'No Cable ID'}</span>
                    <span className="block truncate text-text-secondary">
                      {deviceById[c.source.deviceId]?.label} {c.source.portId ?? '?'} → {deviceById[c.dest.deviceId]?.label} {c.dest.portId ?? '?'} · {MEDIA_LABEL[c.media] ?? c.media}
                      {c.hops.length ? ` · ${c.hops.length} hop(s)` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="min-w-0 space-y-4" data-testid="rackium-editor">
          <div className="text-sm font-semibold text-text">{connection ? 'Edit connection' : 'New connection'}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-text-secondary">Media</span>
              <select aria-label="Media" value={draft.media} disabled={!editable} onChange={(e) => patch({ media: e.target.value })} className={inputClass}>
                {MEDIA.map((m) => (
                  <option key={m} value={m}>
                    {MEDIA_LABEL[m] ?? m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-text-secondary">Speed</span>
              <select aria-label="Speed" value={draft.speed} disabled={!editable} onChange={(e) => patch({ speed: e.target.value })} className={inputClass}>
                {SPEEDS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-text-secondary">Cable ID</span>
              <span className="flex gap-1">
                <input aria-label="Cable ID" value={draft.cableId} maxLength={32} disabled={!editable} onChange={(e) => patch({ cableId: e.target.value })} className={inputClass} />
                {editable && !draft.cableId && (
                  <button type="button" onClick={() => patch({ cableId: view.cableIdSuggestion })} title="Use the next free 8-digit Cable ID" className="h-9 shrink-0 rounded-lg border border-border px-2 text-xs text-brand hover:border-brand">
                    {view.cableIdSuggestion}
                  </button>
                )}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-text-secondary">
                Engineer Selected (m){connection?.lengths.suggestedM != null ? ` · suggested ${connection.lengths.suggestedM}` : ''}
                {connection?.length.lengthEstimated ? ' · Estimated' : ''}
              </span>
              <input aria-label="Engineer Selected length" type="number" min="0" value={draft.engineerSelectedM} disabled={!editable} onChange={(e) => patch({ engineerSelectedM: e.target.value })} className={inputClass} />
            </label>
          </div>
          {connection?.length.estimateReason && <p className="text-xs text-status-amber">Length: {connection.length.estimateReason}</p>}

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
            <EndEditor
              title="Source"
              devices={endDevices}
              device={deviceById[draft.sourceDeviceId]}
              portId={draft.sourcePort}
              sfp={draft.sourceSfpCode}
              optics={fibre ? opticsFor : null}
              media={draft.media}
              connectionId={connection?.id ?? null}
              editable={editable}
              onChange={(p) => patch({ sourceDeviceId: p.deviceId ?? draft.sourceDeviceId, sourcePort: 'portId' in p ? p.portId : draft.sourcePort, sourceSfpCode: 'sfp' in p ? p.sfp : draft.sourceSfpCode })}
            />
            <EndEditor
              title="Destination"
              devices={endDevices}
              device={deviceById[draft.destDeviceId]}
              portId={draft.destPort}
              sfp={draft.destSfpCode}
              optics={fibre ? opticsFor : null}
              media={draft.media}
              connectionId={connection?.id ?? null}
              editable={editable}
              onChange={(p) => patch({ destDeviceId: p.deviceId ?? draft.destDeviceId, destPort: 'portId' in p ? p.portId : draft.destPort, destSfpCode: 'sfp' in p ? p.sfp : draft.destSfpCode })}
            />
          </div>

          <HopsEditor hops={draft.hops} panels={panels} deviceById={deviceById} media={draft.media} connectionId={connection?.id ?? null} editable={editable} onChange={(hops) => patch({ hops })} />

          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={save} disabled={!draft.sourceDeviceId || !draft.destDeviceId} className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:bg-status-grey">
                <Save size={13} strokeWidth={2} />
                {connection ? 'Save connection' : 'Create connection'}
              </button>
              {connection && (
                <button type="button" onClick={remove} className="flex h-9 items-center gap-1.5 rounded-lg border border-status-red/40 px-3 text-xs font-medium text-status-red hover:bg-status-red/5">
                  <Trash2 size={13} strokeWidth={2} />
                  Delete
                </button>
              )}
              {saved && <span className="text-xs text-status-green">{saved}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Suggestion({ suggestion, current, onUse, editable }) {
  if (!editable || !suggestion || suggestion === current) return null
  return (
    <button type="button" onClick={() => onUse(suggestion)} className="flex h-8 items-center gap-1 rounded-lg border border-status-amber/40 px-2 text-xs text-status-amber hover:bg-status-amber/5">
      <Lightbulb size={12} strokeWidth={2} />
      Suggested: {suggestion} — use
    </button>
  )
}

function EndEditor({ title, devices, device, portId, sfp, optics, media, connectionId, editable, onChange }) {
  const { options, suggestion } = portChoices(device, { media, exceptConnectionId: connectionId })
  const side = device?.isPanel ? 'front' : null
  const occupied = device ? [...occupiedKeysOf(device, connectionId)].filter((k) => (side ? k.endsWith(`#${side}`) : !k.includes('#'))).map((k) => device.ports.find((p) => portKey(p.id, side) === k)?.id).filter(Boolean) : []
  const incompatible = options.filter((o) => !o.compatible).length
  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-border bg-surface p-3" data-testid={`end-${title.toLowerCase()}`}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
          <span className="font-semibold text-text">{title} device</span>
          <select aria-label={`${title} device`} value={device?.id ?? ''} disabled={!editable} onChange={(e) => onChange({ deviceId: e.target.value, portId: null })} className={inputClass}>
            <option value="">Choose…</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
                {d.rackCode ? ` (${d.rackCode}${d.ru ? ` RU${d.ru}` : ''})` : ''}
                {d.inDesign ? '' : ' · surveyed'}
              </option>
            ))}
          </select>
        </label>
        <Suggestion suggestion={suggestion} current={portId} onUse={(p) => onChange({ portId: p })} editable={editable} />
      </div>
      {device && (
        <PortFace
          title={device.label}
          sublabel={`${device.model ?? ''}${device.isPanel ? ' · cable lands on the front' : ''}${incompatible ? ` · ${incompatible} port(s) not for ${media.toUpperCase()}` : ''}`}
          portMap={portMapOf(device)}
          occupiedPortIds={occupied}
          selectedPortId={portId}
          onSelectPort={(p) => onChange({ portId: p })}
          disabled={!editable}
        />
      )}
      {optics && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-text-secondary">Optic</span>
          <select aria-label={`${title} optic`} value={sfp ?? ''} disabled={!editable} onChange={(e) => onChange({ sfp: e.target.value || null })} className={inputClass}>
            <option value="">None</option>
            {[...new Set([...(sfp ? [sfp] : []), ...optics])].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function HopsEditor({ hops, panels, deviceById, media, connectionId, editable, onChange }) {
  const set = (i, p) => onChange(hops.map((h, j) => (j === i ? { ...h, ...p } : h)))
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3" data-testid="hops">
      <div className="flex items-center justify-between text-xs font-semibold text-text">
        Patch-panel hops ({hops.length})
        {editable && (
          <button type="button" disabled={panels.length === 0 || hops.length >= 8} onClick={() => onChange([...hops, { patchPanelId: '', inPort: '', outPort: '', segmentCableId: '' }])} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 font-medium text-brand hover:border-brand disabled:text-text-secondary">
            <Plus size={12} strokeWidth={2} />
            Add hop
          </button>
        )}
      </div>
      {panels.length === 0 && <p className="text-xs text-text-secondary">No patch panel in this building yet — add one in Rack Elevations.</p>}
      {hops.length === 0 && panels.length > 0 && <p className="text-xs text-text-secondary">Direct cable (no hops).</p>}
      {hops.map((hop, i) => {
        const panel = deviceById[hop.patchPanelId]
        const rear = portChoices(panel, { media, side: 'rear', exceptConnectionId: connectionId })
        const front = portChoices(panel, { media, side: 'front', exceptConnectionId: connectionId })
        return (
          <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border/60 p-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              <span className="text-text-secondary">Hop {i + 1} panel</span>
              <select aria-label={`Hop ${i + 1} panel`} value={hop.patchPanelId} disabled={!editable} onChange={(e) => set(i, { patchPanelId: e.target.value, inPort: '', outPort: '' })} className={inputClass}>
                <option value="">Choose…</option>
                {panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.rackCode})
                  </option>
                ))}
              </select>
            </label>
            <PanelPortSelect label={`Hop ${i + 1} in (rear)`} choices={rear} value={hop.inPort} editable={editable} onChange={(v) => set(i, { inPort: v })} />
            <PanelPortSelect label={`Hop ${i + 1} out (front)`} choices={front} value={hop.outPort} editable={editable} onChange={(v) => set(i, { outPort: v })} />
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              <span className="text-text-secondary">Segment Cable ID</span>
              <input aria-label={`Hop ${i + 1} segment Cable ID`} value={hop.segmentCableId ?? ''} maxLength={32} disabled={!editable} onChange={(e) => set(i, { segmentCableId: e.target.value })} className={inputClass} />
            </label>
            {editable && (
              <button type="button" aria-label={`Remove hop ${i + 1}`} onClick={() => onChange(hops.filter((_, j) => j !== i))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-status-red hover:border-status-red">
                <Trash2 size={13} strokeWidth={2} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PanelPortSelect({ label, choices, value, editable, onChange }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-text-secondary">{label}</span>
        <select aria-label={label} value={value} disabled={!editable || choices.options.length === 0} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">—</option>
          {choices.options.map((o) => (
            <option key={o.id} value={o.id} disabled={o.occupied && o.id !== value}>
              {o.id}
              {o.occupied ? ' (in use)' : ''}
            </option>
          ))}
        </select>
      </label>
      {editable && choices.suggestion && !value && (
        <button type="button" onClick={() => onChange(choices.suggestion)} className="self-start text-status-amber underline">
          Suggested: {choices.suggestion} — use
        </button>
      )}
    </div>
  )
}
