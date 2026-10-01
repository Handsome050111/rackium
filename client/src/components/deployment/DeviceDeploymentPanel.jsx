import { useState } from 'react'
import { ScanLine, CheckCircle2, Link2, Camera, AlertTriangle, ShieldCheck, Clock3 } from 'lucide-react'
import EvidenceSlots from '../EvidenceSlots.jsx'
import { CHECKLIST_ITEMS } from '../../lib/deploymentModel.js'
import { DGUV_LABEL } from '../../lib/dguv.js'
import { useRole } from '../../lib/RoleContext.jsx'
import { canRecordDeployment, canAcceptDevice } from '../../lib/permissions.js'

const inputClass = 'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'
const DGUV_COLOR = { valid: 'text-status-green', expiring_soon: 'text-status-amber', expiring: 'text-status-amber', overdue: 'text-status-red' }

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

// Phone-first by construction: one column, no responsive grid that would
// need a breakpoint override to collapse (brief Step 8: "fully usable at
// 390px").
export default function DeviceDeploymentPanel({ detail, onRecordSerialMac, onConfirmInstallation, onConfirmUplinking, onRecordLinkTest, onRecordDguv, onAddEvidence, onAccept }) {
  const { role } = useRole()
  const editable = canRecordDeployment(role)
  const canAccept = canAcceptDevice(role)
  const { device, connections, exceptions } = detail

  const [serial, setSerial] = useState(device.installation?.serial ?? '')
  const [mac, setMac] = useState(device.installation?.mac ?? '')
  const [confirmedRu, setConfirmedRu] = useState(device.installation?.confirmedRu ?? device.ru ?? '')
  const [pduOutlet, setPduOutlet] = useState(device.installation?.pduOutlet ?? '')
  const [dguvDate, setDguvDate] = useState(device.installation?.dguvDate ?? '')
  const [serialError, setSerialError] = useState(null)

  if (!device.deliveryReady) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="text-sm font-semibold text-text">{device.label}</div>
        <div className="flex items-center gap-2 rounded-lg border border-status-amber/40 bg-status-amber/5 px-3 py-2.5 text-xs text-status-amber">
          <Clock3 size={15} strokeWidth={2} className="shrink-0" />
          Awaiting delivery — materials for this device have not been marked Delivered in the BOM yet.
        </div>
      </div>
    )
  }

  async function handleSaveSerial() {
    const result = await onRecordSerialMac(device.id, { serial, mac })
    setSerialError(result.ok ? null : result.error)
  }

  async function handleConfirmInstall() {
    await onConfirmInstallation(device.id, { confirmedRu: confirmedRu === '' ? null : Number(confirmedRu), pduOutlet })
  }

  async function handleDguvSave() {
    await onRecordDguv(device.id, dguvDate)
  }

  const progress = device.checklistProgress

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-text">{device.label}</div>
            <div className="text-xs text-text-secondary">{device.hostname}</div>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              device.deploymentLabel === 'Ready' ? 'bg-status-green/10 text-status-green' : device.deploymentLabel === 'Installed' ? 'bg-brand/10 text-brand' : 'bg-status-amber/10 text-status-amber'
            }`}
          >
            {device.deploymentLabel}
          </span>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <ScanLine size={16} strokeWidth={2} className="text-brand" />
          Scan device
        </div>
        <Field label="Serial number">
          <input value={serial} onChange={(e) => setSerial(e.target.value)} disabled={!editable} className={inputClass} placeholder="e.g. FCW2637A1B2" />
        </Field>
        <Field label="MAC address">
          <input value={mac} onChange={(e) => setMac(e.target.value)} disabled={!editable} className={inputClass} placeholder="00:1A:2B:3C:4D:5E" />
        </Field>
        {serialError && <p className="text-xs text-status-red">{serialError}</p>}
        {device.installation?.serialValidation && (
          <p className={`text-xs ${device.installation.serialValidation === 'validated' ? 'text-status-green' : 'text-status-amber'}`}>
            {device.installation.serialValidation === 'validated' ? 'Validated against CMO' : 'Not found in CMO — recorded anyway'}
          </p>
        )}
        {editable && (
          <button type="button" onClick={handleSaveSerial} className="h-9 w-full rounded-lg bg-brand text-xs font-medium text-white hover:bg-brand/90">
            Save serial &amp; MAC
          </button>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <CheckCircle2 size={16} strokeWidth={2} className="text-brand" />
          Confirm installation
        </div>
        <Field label={`Rack / RU (planned: RU${device.ru ?? '—'})`}>
          <input type="number" value={confirmedRu} onChange={(e) => setConfirmedRu(e.target.value)} disabled={!editable} className={inputClass} />
        </Field>
        <Field label="PDU outlet">
          <input value={pduOutlet} onChange={(e) => setPduOutlet(e.target.value)} disabled={!editable} className={inputClass} placeholder="e.g. PDU-A outlet 06" />
        </Field>
        {editable && (
          <button type="button" onClick={handleConfirmInstall} className="h-9 w-full rounded-lg bg-brand text-xs font-medium text-white hover:bg-brand/90">
            Confirm Installation
          </button>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Link2 size={16} strokeWidth={2} className="text-brand" />
          Uplinking ({connections.length})
        </div>
        {connections.length === 0 ? (
          <p className="text-xs text-text-secondary">No connections on this device.</p>
        ) : (
          connections.map((conn) => (
            <ConnectionRow key={conn.id} connection={conn} deviceId={device.id} editable={editable} onConfirmUplinking={onConfirmUplinking} onRecordLinkTest={onRecordLinkTest} />
          ))
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
        <div className="text-sm font-semibold text-text">
          Installation checklist ({progress.done}/{progress.total})
        </div>
        <ul className="space-y-1">
          {CHECKLIST_ITEMS.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-xs">
              <CheckCircle2 size={14} strokeWidth={2} className={device.installation?.checklist?.[item.id] ? 'text-status-green' : 'text-border'} />
              <span className={device.installation?.checklist?.[item.id] ? 'text-text' : 'text-text-secondary'}>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
        <div className="text-sm font-semibold text-text">DGUV inspection</div>
        <Field label="Inspection date">
          <input type="date" value={dguvDate} onChange={(e) => setDguvDate(e.target.value)} disabled={!editable} className={inputClass} />
        </Field>
        {editable && (
          <button type="button" onClick={handleDguvSave} className="h-9 w-full rounded-lg border border-border text-xs font-medium text-text hover:border-brand">
            Save inspection date
          </button>
        )}
        {device.dguv && (
          <p className={`text-xs font-medium ${DGUV_COLOR[device.dguv.status]}`}>
            {DGUV_LABEL[device.dguv.status]}
            {device.dguv.dueDate ? ` — due ${new Date(device.dguv.dueDate).toLocaleDateString()}` : ''}
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Camera size={16} strokeWidth={2} className="text-brand" />
          Evidence ({device.installation?.evidenceCount ?? 0})
        </div>
        <EvidenceSlots labels={['Installed device', 'Label', 'Cable connections', 'Rack overview']} disabled={!editable} />
        {editable && (
          <button type="button" onClick={() => onAddEvidence(device.id)} className="h-9 w-full rounded-lg border border-border text-xs font-medium text-text hover:border-brand">
            Record evidence added
          </button>
        )}
      </div>

      {exceptions.length > 0 && (
        <div className="space-y-2 rounded-xl border border-status-amber/40 bg-status-amber/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-status-amber">
            <AlertTriangle size={16} strokeWidth={2} />
            Exceptions ({exceptions.filter((e) => !e.resolved).length} open)
          </div>
          {exceptions.map((exc) => (
            <div key={exc.id} className="rounded-lg border border-border bg-surface p-2.5 text-xs">
              <div className="font-medium text-text">{exc.label}</div>
              <div className="text-text-secondary">
                Designed: <span className="text-text">{exc.designedValue}</span> · Installed: <span className="text-text">{exc.installedValue}</span>
              </div>
              <div className="text-text-secondary">{exc.reason}</div>
              <div className={`mt-1 font-medium ${exc.resolved ? 'text-status-green' : 'text-status-amber'}`}>{exc.resolved ? 'Resolved' : 'Open'}</div>
            </div>
          ))}
        </div>
      )}

      {canAccept && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <button
            type="button"
            disabled={device.status === 'accepted' || device.status === 'in_service'}
            onClick={() => onAccept(device.id)}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-status-green text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-status-grey"
          >
            <ShieldCheck size={14} strokeWidth={2} />
            {device.status === 'accepted' || device.status === 'in_service' ? 'Accepted' : 'Accept device'}
          </button>
        </div>
      )}
    </div>
  )
}

function ConnectionRow({ connection, deviceId, editable, onConfirmUplinking, onRecordLinkTest }) {
  const [media, setMedia] = useState(connection.installed?.media ?? connection.media)
  const [cableId, setCableId] = useState(connection.installed?.cableId ?? connection.cableId ?? '')
  const live = connection.status === 'installed' || connection.status === 'tested' || connection.status === 'accepted' || connection.status === 'in_service'

  async function handleConfirm() {
    await onConfirmUplinking(
      connection.id,
      { media, sourceSfp: connection.sourceSfp, destSfp: connection.destSfp, sourcePort: connection.source.port, destPort: connection.dest.port, cableId },
      deviceId
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-text">
          {connection.source.port} → {connection.dest.deviceId}
        </span>
        <span className={live ? 'text-status-green' : 'text-text-secondary'}>{live ? 'Patched' : 'Pending'}</span>
      </div>
      <Field label="Installed media">
        <select value={media} onChange={(e) => setMedia(e.target.value)} disabled={!editable} className={inputClass}>
          {['cat6a', 'os2', 'om4', 'dac', 'stack'].map((m) => (
            <option key={m} value={m}>
              {m.toUpperCase()}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cable ID">
        <input value={cableId} onChange={(e) => setCableId(e.target.value)} disabled={!editable} className={inputClass} />
      </Field>
      {editable && (
        <div className="flex gap-2">
          <button type="button" onClick={handleConfirm} className="h-8 flex-1 rounded-lg bg-brand text-[11px] font-medium text-white hover:bg-brand/90">
            Confirm Uplinking
          </button>
          <button type="button" onClick={() => onRecordLinkTest(connection.id, 'pass')} className="h-8 flex-1 rounded-lg border border-border text-[11px] font-medium text-text hover:border-brand">
            Record link test
          </button>
        </div>
      )}
    </div>
  )
}
