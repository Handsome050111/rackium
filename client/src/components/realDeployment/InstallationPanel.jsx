import { useEffect, useState } from 'react'
import { Camera, MapPin, PackageX, ShieldCheck, Upload, Wrench } from 'lucide-react'
import { macProblem, serialProblem, DGUV_STATUS_LABEL } from '@rackium/shared/deployment.js'
import { deploymentApi, installationDraft, installationBody } from '../../api/deploymentApi.js'
import { filesApi } from '../../api/filesApi.js'
import ConnectionPatching from './ConnectionPatching.jsx'

const input = 'h-touch w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-sm text-text focus:border-brand focus:outline-none disabled:bg-surface-muted'
const STATUS_TONE = { planned: 'text-text-secondary', ordered: 'text-text-secondary', delivered: 'text-brand', installed: 'text-status-amber', configured: 'text-status-amber', tested: 'text-status-green', accepted: 'text-status-green' }
const DGUV_TONE = { valid: 'text-status-green', expiring_soon: 'text-status-amber', expiring: 'text-status-amber', overdue: 'text-status-red' }

function Section({ title, icon: Icon, children }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
        {Icon && <Icon size={16} strokeWidth={2} className="text-brand" />}
        {title}
      </h3>
      {children}
    </section>
  )
}

// The Field Engineer's installation record of one device (brief §5.7, §6.9),
// phone first: placement, serial/MAC, PDU outlet, GPS, evidence photos, DGUV
// inspection, patching per connection and cable, deviations and the steps to
// Accepted. `act(fn, notice)` runs an API call and reloads the screen.
// The PM overrides the device's DGUV obligation from its model's default
// (addendum v2.3 Q13): exempt it, or require it anyway — always with a
// reason — or put it back to the default.
function DguvOverride({ device, onSave }) {
  const [reason, setReason] = useState('')
  const override = device.dguv?.override ?? null
  const byType = device.dguv?.byType ?? false
  if (override) {
    return (
      <button type="button" className="h-touch rounded-lg border border-border px-3 text-sm font-medium text-text" onClick={() => onSave({ required: null }, "DGUV back to the model's default")}>
        {override.required ? 'Stop requiring inspection' : 'Clear the exemption'} (back to the model’s default)
      </button>
    )
  }
  const required = !byType
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="dguv-override">
      <label className="min-w-0 flex-1 text-xs text-text-secondary">
        {required ? 'Reason to require inspection' : 'Reason for exemption'}
        <input className={input} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="button" disabled={!reason.trim()} className="h-touch rounded-lg border border-border px-3 text-sm font-medium text-text disabled:opacity-50" onClick={() => onSave({ required, reason: reason.trim() }, required ? 'DGUV inspection required' : 'Device exempt from DGUV inspection')}>
        {required ? 'Require inspection' : 'Exempt from inspection'}
      </button>
    </div>
  )
}

export default function InstallationPanel({ device, connections, racks, orgId, projectId, today, permissions, act, onLogException }) {
  const [draft, setDraft] = useState(() => installationDraft(device))
  const [gps, setGps] = useState(device.installation.gps)
  const [photos, setPhotos] = useState([])
  const [dguv, setDguv] = useState({ inspectionDate: device.dguv?.lastInspectionDate ?? today, inspector: device.dguv?.inspector ?? '', certificateFileId: device.dguv?.certificateFileId ?? null })
  const [busy, setBusy] = useState(false)
  const canInstall = permissions.install && !['accepted', 'in_service', 'maintenance'].includes(device.status)
  const gated = !device.delivery.delivered && ['planned', 'ordered'].includes(device.status)
  const placed = Boolean(device.rackId)

  const loadPhotos = () => filesApi.list(orgId, projectId, { type: 'device', id: device.id }).then((r) => setPhotos(r.files ?? []))
  useEffect(() => {
    let alive = true
    filesApi.list(orgId, projectId, { type: 'device', id: device.id }).then((r) => alive && setPhotos(r.files ?? [])).catch(() => {})
    return () => {
      alive = false
    }
  }, [orgId, projectId, device.id])

  const serialMsg = draft.serial ? serialProblem(draft.serial.trim()) : null
  const macMsg = macProblem(draft.mac)
  const save = (markInstalled) =>
    act(() => deploymentApi.saveInstallation(orgId, projectId, device.id, { ...installationBody(draft, { placed }), ...(gps ? { gps } : {}), ...(markInstalled ? { markInstalled: true } : {}) }), markInstalled ? `${device.label} installed` : 'Installation saved')
  function locate() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition((pos) => setGps({ lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6, accuracyM: Math.round(pos.coords.accuracy) }), () => {}, { enableHighAccuracy: true, timeout: 10000 })
  }
  async function addFile(file, category) {
    if (!file) return null
    setBusy(true)
    try {
      const saved = await deploymentApi.uploadDeviceFile(orgId, projectId, device.id, file, category)
      await loadPhotos()
      return saved
    } finally {
      setBusy(false)
    }
  }
  const evidence = photos.filter((f) => f.category !== 'certificate')
  const certificates = photos.filter((f) => f.category === 'certificate')
  const ownDeviations = device.deviations

  return (
    <div className="space-y-3" data-testid="installation-panel">
      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="break-words text-base font-bold text-text">{device.label}</h2>
            <div className="text-xs text-text-secondary">
              {[device.roleLabel ?? device.category, device.model, device.roomCode, placed ? `${device.rackCode} RU${device.ru} ${device.face}` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
          <span className={`text-sm font-semibold ${STATUS_TONE[device.status] ?? 'text-text'}`} data-testid="device-status">
            {device.statusLabel}
          </span>
        </div>
        {gated && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-status-amber/10 px-3 py-2 text-sm font-medium text-status-amber" role="status">
            <PackageX size={16} strokeWidth={2} /> Awaiting delivery — procurement line is {device.delivery.status.replace('_', ' ')}
          </div>
        )}
      </div>

      <Section title="Installation" icon={Wrench}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {device.serialised && (
            <label className="text-xs text-text-secondary">
              Serial number
              <input className={input} value={draft.serial} disabled={!canInstall || gated} autoCapitalize="characters" onChange={(e) => setDraft({ ...draft, serial: e.target.value })} />
              {serialMsg && <span className="text-status-red">{serialMsg}</span>}
            </label>
          )}
          <label className="text-xs text-text-secondary">
            MAC address
            <input className={input} value={draft.mac} disabled={!canInstall || gated} placeholder="00:1A:2B:3C:4D:5E" onChange={(e) => setDraft({ ...draft, mac: e.target.value })} />
            {macMsg && <span className="text-status-red">{macMsg}</span>}
          </label>
          {placed && (
            <>
              <label className="text-xs text-text-secondary">
                Rack
                <select className={input} value={draft.rackId} disabled={!canInstall || gated} onChange={(e) => setDraft({ ...draft, rackId: e.target.value })}>
                  {racks.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-text-secondary">
                  RU
                  <input className={input} type="number" inputMode="numeric" min="1" max="60" value={draft.ru} disabled={!canInstall || gated} onChange={(e) => setDraft({ ...draft, ru: e.target.value })} />
                </label>
                <label className="text-xs text-text-secondary">
                  Face
                  <select className={input} value={draft.face} disabled={!canInstall || gated} onChange={(e) => setDraft({ ...draft, face: e.target.value })}>
                    <option value="front">Front</option>
                    <option value="rear">Rear</option>
                  </select>
                </label>
              </div>
            </>
          )}
          <label className="text-xs text-text-secondary">
            PDU outlet
            <input className={input} value={draft.pduOutlet} disabled={!canInstall || gated} placeholder="A-07" onChange={(e) => setDraft({ ...draft, pduOutlet: e.target.value })} />
          </label>
          <label className="text-xs text-text-secondary sm:col-span-2">
            Notes
            <input className={input} value={draft.notes} disabled={!canInstall || gated} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <button type="button" className="inline-flex h-touch items-center gap-1 rounded-lg border border-border px-3 text-sm text-text disabled:opacity-50" disabled={!canInstall || gated} onClick={locate}>
            <MapPin size={16} strokeWidth={2} /> Add GPS (optional)
          </button>
          {gps && (
            <span>
              {gps.lat}, {gps.lng}
              {gps.accuracyM != null ? ` ±${gps.accuracyM} m` : ''}
            </span>
          )}
        </div>
        {device.installation.technician && (
          <div className="text-xs text-text-secondary">
            Recorded by {device.installation.technician}
            {device.installation.installedAt ? ` · installed ${new Date(device.installation.installedAt).toLocaleString()}` : ''}
          </div>
        )}
        {ownDeviations.length > 0 && (
          <ul className="space-y-1 text-xs" aria-label="Deviations from the design">
            {ownDeviations.map((x) => (
              <li key={x.field} className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 ${x.handled ? 'bg-surface-muted text-text-secondary' : 'bg-status-amber/10 text-status-amber'}`}>
                <span className="font-semibold">{x.label}</span>
                <span>
                  designed {x.designedValue}, installed {x.installedValue}
                </span>
                {x.handled ? <span>· exception logged</span> : canInstall && <button type="button" className="ml-auto h-8 rounded-lg border border-current px-2 font-medium" onClick={() => onLogException({ deviceId: device.id, connectionId: null, deviation: x })}>Log exception</button>}
              </li>
            ))}
          </ul>
        )}
        {canInstall && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="h-touch rounded-lg border border-border px-3 text-sm font-medium text-text disabled:opacity-50" disabled={gated || Boolean(serialMsg || macMsg)} onClick={() => save(false)}>
              Save
            </button>
            {!['installed', 'configured', 'tested'].includes(device.status) && (
              <button type="button" className="h-touch rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={gated || Boolean(serialMsg || macMsg)} onClick={() => save(true)}>
                Mark installed
              </button>
            )}
          </div>
        )}
      </Section>

      <Section title={`Evidence photos (${evidence.length})`} icon={Camera}>
        <div className="flex flex-wrap gap-2">
          {evidence.map((f) => (
            <a key={f.id} href={filesApi.contentUrl(orgId, projectId, f.id)} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-lg border border-border bg-surface-muted">
              {f.hasThumbnail ? <img src={filesApi.thumbnailUrl(orgId, projectId, f.id)} alt={f.fileName} className="h-full w-full object-cover" /> : <span className="p-1 text-[10px]">{f.fileName}</span>}
            </a>
          ))}
        </div>
        {permissions.install && !gated && (
          <label className="inline-flex h-touch cursor-pointer items-center gap-1 rounded-lg border border-border px-3 text-sm text-text">
            <Upload size={16} strokeWidth={2} /> {busy ? 'Uploading…' : 'Add photo'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Add evidence photo" onChange={(e) => addFile(e.target.files?.[0], 'evidence').finally(() => (e.target.value = ''))} />
          </label>
        )}
      </Section>

      {(device.dguv || (permissions.overrideDguv && !device.passive)) && (
        <Section title="DGUV V3 inspection" icon={ShieldCheck}>
          {device.dguv?.exempt && (
            <div className="text-sm font-semibold text-text-secondary" data-testid="dguv-status">
              Exempt{' '}
              <span className="font-normal">— {device.dguv.override?.reason}{device.dguv.override?.setBy ? ` (${device.dguv.override.setBy})` : ''}</span>
            </div>
          )}
          {device.dguv && !device.dguv.exempt && (
            <div className={`text-sm font-semibold ${DGUV_TONE[device.dguv.status] ?? 'text-text'}`} data-testid="dguv-status">
              {DGUV_STATUS_LABEL[device.dguv.status]}{' '}
              <span className="font-normal text-text-secondary">
                {device.dguv.lastInspectionDate ? `inspected ${device.dguv.lastInspectionDate} by ${device.dguv.inspector} · due ${device.dguv.dueDate}` : 'no inspection recorded'}
              </span>
            </div>
          )}
          {permissions.overrideDguv && <DguvOverride device={device} onSave={(body, message) => act(() => deploymentApi.overrideDguv(orgId, projectId, device.id, body), message)} />}
          {permissions.recordDguv && device.dguv?.required && ['installed', 'configured', 'tested'].includes(device.status) && (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-text-secondary">
                  Inspection date
                  <input className={input} type="date" max={today} value={dguv.inspectionDate} onChange={(e) => setDguv({ ...dguv, inspectionDate: e.target.value })} />
                </label>
                <label className="text-xs text-text-secondary">
                  Inspector
                  <input className={input} value={dguv.inspector} onChange={(e) => setDguv({ ...dguv, inspector: e.target.value })} />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex h-touch cursor-pointer items-center gap-1 rounded-lg border border-border px-3 text-sm text-text">
                  <Upload size={16} strokeWidth={2} /> Certificate (optional)
                  <input type="file" accept="image/*,application/pdf" className="sr-only" aria-label="Add DGUV certificate" onChange={async (e) => {
                    const saved = await addFile(e.target.files?.[0], 'certificate')
                    if (saved?.id) setDguv((d) => ({ ...d, certificateFileId: saved.id }))
                    e.target.value = ''
                  }} />
                </label>
                {(dguv.certificateFileId || certificates.length > 0) && <span className="text-xs text-text-secondary">{certificates.map((c) => c.fileName).join(', ')}</span>}
                <button type="button" className="h-touch rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={!dguv.inspector.trim() || !dguv.inspectionDate} onClick={() => act(() => deploymentApi.recordDguv(orgId, projectId, device.id, { inspectionDate: dguv.inspectionDate, inspector: dguv.inspector.trim(), certificateFileId: dguv.certificateFileId }), 'DGUV inspection recorded')}>
                  Record inspection
                </button>
              </div>
            </>
          )}
        </Section>
      )}

      {connections.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-1 text-sm font-semibold text-text">Uplinks and patching ({connections.length})</h3>
          {connections.map((c) => (
            <ConnectionPatching
              key={`${c.id}:${c.status}:${c.version ?? 0}:${c.segments.map((s) => s.installed?.cableId ?? '').join()}`}
              conn={c}
              canInstall={permissions.install && !gated}
              canAccept={permissions.accept}
              onSave={(body) => act(() => deploymentApi.saveConnection(orgId, projectId, c.id, { ...body, version: c.version ?? 0 }), body.confirm ? 'Patching confirmed' : 'Patching saved')}
              onTest={(result) => act(() => deploymentApi.testConnection(orgId, projectId, c.id, { result }), result === 'pass' ? 'Link test passed' : 'Link test failed')}
              onAccept={() => act(() => deploymentApi.acceptConnection(orgId, projectId, c.id), 'Connection accepted')}
              onLogException={(x) => onLogException({ deviceId: device.id, connectionId: c.id, deviation: x })}
            />
          ))}
        </section>
      )}

      <Section title="Status" icon={ShieldCheck}>
        <ol className="flex flex-wrap gap-1 text-xs">
          {['delivered', 'installed', 'configured', 'tested', 'accepted'].map((s) => {
            const done = device.history.some((h) => h.status === s) || (s === 'delivered' && device.delivery.delivered)
            return (
              <li key={s} className={`rounded-full px-2 py-1 ${done ? 'bg-status-green/10 font-semibold text-status-green' : 'bg-surface-muted text-text-secondary'}`}>
                {s[0].toUpperCase() + s.slice(1)}
              </li>
            )
          })}
        </ol>
        {device.acceptanceBlockers.length > 0 && device.status !== 'accepted' && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-text-secondary" aria-label="Before acceptance">
            {device.acceptanceBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {permissions.install && device.status === 'installed' && (
            <button type="button" className="h-touch rounded-lg border border-brand px-3 text-sm font-medium text-brand" onClick={() => act(() => deploymentApi.setStatus(orgId, projectId, device.id, { status: 'configured' }), 'Marked configured')}>
              Mark configured
            </button>
          )}
          {permissions.install && device.status === 'configured' && (
            <button type="button" className="h-touch rounded-lg border border-brand px-3 text-sm font-medium text-brand" onClick={() => act(() => deploymentApi.setStatus(orgId, projectId, device.id, { status: 'tested' }), 'Marked tested')}>
              Mark tested
            </button>
          )}
          {permissions.accept && device.status === 'tested' && (
            <button type="button" className="h-touch rounded-lg bg-status-green px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={device.acceptanceBlockers.length > 0} onClick={() => act(() => deploymentApi.setStatus(orgId, projectId, device.id, { status: 'accepted' }), `${device.label} accepted`)}>
              Accept device
            </button>
          )}
        </div>
        {device.acceptedAt && <div className="text-xs text-status-green">Accepted by {device.acceptedBy} on {new Date(device.acceptedAt).toLocaleDateString()}</div>}
      </Section>
    </div>
  )
}
