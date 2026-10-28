import { useState } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { TOOL_TITLES, DEVICE_TOOLS as NEEDS_DEVICE } from './hldTools.js'

// The HLD design tools (M7b-3, DATA-MODEL §5.20; addendum v2.3 Q1): Break
// Uplink, Reroute, Replace Endpoint and Split act on the chosen uplink, Merge
// on the chosen device. The server checks everything again (free ports,
// pathways, revisions); what it refuses is shown above the canvas.

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-surface-muted'
const primary = 'h-touch rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9'
const secondary = 'h-touch rounded-lg border border-border px-3 text-xs font-medium text-text hover:bg-surface-muted sm:h-9'


function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

const nameOf = (d) => d?.hostname ?? d?.label ?? 'device'

export default function HldToolPanel({ tool, connection, device, devices, connections, rooms, roles, busy, onApply, onCancel }) {
  const title = TOOL_TITLES[tool]
  const byId = new Map(devices.map((d) => [d.id, d]))
  const target = NEEDS_DEVICE.has(tool) ? device : connection
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="hld-tool-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <button type="button" onClick={onCancel} aria-label={`Close ${title}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      {!target ? (
        <p className="text-xs text-text-secondary">{NEEDS_DEVICE.has(tool) ? 'Select the device to take out of the path on the canvas.' : 'Select an uplink on the canvas.'}</p>
      ) : (
        <>
          {connection && !NEEDS_DEVICE.has(tool) && (
            <p className="break-all text-xs text-text" data-testid="hld-tool-uplink">
              {nameOf(byId.get(connection.source.deviceId))} — {nameOf(byId.get(connection.dest.deviceId))}
              <span className="text-text-secondary">
                {' '}
                · {connection.media.toUpperCase()} {connection.speed}
                {connection.cableId ? ` · ${connection.cableId}` : ''}
                {connection.length?.suggestedM != null ? ` · ${connection.length.suggestedM} m` : ''}
              </span>
            </p>
          )}
          {tool === 'break-uplink' && <BreakForm key={connection.id} busy={busy} onApply={onApply} onCancel={onCancel} />}
          {tool === 'reroute' && <RerouteForm key={connection.id} connection={connection} byId={byId} rooms={rooms} busy={busy} onApply={onApply} onCancel={onCancel} />}
          {tool === 'replace-endpoint' && <ReplaceForm key={connection.id} connection={connection} devices={devices} byId={byId} busy={busy} onApply={onApply} onCancel={onCancel} />}
          {tool === 'split' && <SplitForm key={connection.id} connection={connection} devices={devices} rooms={rooms} roles={roles} busy={busy} onApply={onApply} onCancel={onCancel} />}
          {tool === 'merge' && <MergeForm key={device.id} device={device} connections={connections} byId={byId} busy={busy} onApply={onApply} onCancel={onCancel} />}
        </>
      )}
    </div>
  )
}

function Actions({ label, disabled, busy, onApply, onCancel }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className={secondary}>
        Cancel
      </button>
      <button type="button" disabled={disabled || busy} onClick={onApply} className={primary}>
        {label}
      </button>
    </div>
  )
}

function BreakForm({ busy, onApply, onCancel }) {
  const [reason, setReason] = useState('')
  return (
    <>
      <p className="text-xs text-text-secondary">Both ports are released and the cable ID retired. The uplink is archived with your reason, and both devices are flagged "uplink needed" (a warning).</p>
      <Field label="Reason (kept with the archived uplink)">
        <input aria-label="Reason for breaking the uplink" className={inputClass} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Actions label="Break uplink" disabled={!reason.trim()} busy={busy} onApply={() => onApply({ reason: reason.trim() })} onCancel={onCancel} />
    </>
  )
}

function RerouteForm({ connection, byId, rooms, busy, onApply, onCancel }) {
  const [viaPatchPanel, setViaPatchPanel] = useState(Boolean(connection.viaPatchPanel))
  const [via, setVia] = useState(connection.route?.viaRoomIds ?? [])
  const [adding, setAdding] = useState('')
  const ends = [byId.get(connection.source.deviceId)?.roomId, byId.get(connection.dest.deviceId)?.roomId]
  const crossRoom = ends[0] && ends[1] && ends[0] !== ends[1]
  const code = (id) => rooms.find((r) => r.id === id)?.code ?? 'room'
  const choices = rooms.filter((r) => !ends.includes(r.id) && !via.includes(r.id))
  const move = (i, d) => setVia((v) => {
    const next = [...v]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    return next
  })
  const unchanged = viaPatchPanel === Boolean(connection.viaPatchPanel) && via.join() === (connection.route?.viaRoomIds ?? []).join()
  return (
    <>
      <p className="text-xs text-text-secondary">The same devices and ports, another route. The length is recalculated from the pathways along it, and the BOM follows.</p>
      <label className="flex min-h-[40px] items-center gap-2 text-sm text-text">
        <input type="checkbox" className="h-5 w-5" checked={viaPatchPanel} onChange={(e) => setViaPatchPanel(e.target.checked)} />
        Through the destination room's patch panel
      </label>
      {crossRoom ? (
        <div className="space-y-2">
          <span className="text-xs text-text-secondary">
            Route: {code(ends[0])} → {via.map(code).join(' → ')}
            {via.length ? ' → ' : ''}
            {code(ends[1])}
          </span>
          <ul className="space-y-1" aria-label="Rooms the cable passes through">
            {via.map((id, i) => (
              <li key={id} className="flex items-center gap-1 text-xs text-text">
                <span className="flex-1 break-all">{code(id)}</span>
                <button type="button" aria-label={`Move ${code(id)} earlier`} disabled={i === 0} onClick={() => move(i, -1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary disabled:opacity-30">
                  <ArrowUp size={14} />
                </button>
                <button type="button" aria-label={`Move ${code(id)} later`} disabled={i === via.length - 1} onClick={() => move(i, 1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary disabled:opacity-30">
                  <ArrowDown size={14} />
                </button>
                <button type="button" aria-label={`Remove ${code(id)} from the route`} onClick={() => setVia((v) => v.filter((x) => x !== id))} className="flex h-8 w-8 items-center justify-center rounded-lg text-status-red">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          {choices.length > 0 && (
            <div className="flex items-end gap-2">
              <Field label="Through room">
                <select aria-label="Room to route through" className={inputClass} value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">Choose a room…</option>
                  {choices.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="button" disabled={!adding} onClick={() => (setVia((v) => [...v, adding]), setAdding(''))} className={secondary}>
                Add
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-text-secondary">Both ends are in one room: only the patch-panel routing can change.</p>
      )}
      <Actions label="Reroute" disabled={unchanged} busy={busy} onApply={() => onApply({ viaPatchPanel, ...(crossRoom ? { viaRoomIds: via } : {}) })} onCancel={onCancel} />
    </>
  )
}

function ReplaceForm({ connection, devices, byId, busy, onApply, onCancel }) {
  const [end, setEnd] = useState('dest')
  const [deviceId, setDeviceId] = useState('')
  const [portId, setPortId] = useState('')
  const [keepCableId, setKeepCableId] = useState(false)
  const other = end === 'source' ? 'dest' : 'source'
  const choices = devices.filter((d) => d.id !== connection[other].deviceId && d.id !== connection[end].deviceId)
  const chosen = byId.get(deviceId)
  return (
    <>
      <fieldset className="space-y-1">
        <legend className="text-xs text-text-secondary">End to move</legend>
        {['source', 'dest'].map((e) => (
          <label key={e} className="flex min-h-[40px] items-center gap-2 break-all text-sm text-text">
            <input type="radio" name="replace-end" className="h-5 w-5 shrink-0" checked={end === e} onChange={() => (setEnd(e), setDeviceId(''), setPortId(''))} />
            {nameOf(byId.get(connection[e].deviceId))}
            {connection[e].portId ? ` ${connection[e].portId}` : ''}
          </label>
        ))}
      </fieldset>
      <Field label="New device">
        <select aria-label="New device for this end" className={inputClass} value={deviceId} onChange={(e) => (setDeviceId(e.target.value), setPortId(''))}>
          <option value="">Choose a device…</option>
          {choices.map((d) => (
            <option key={d.id} value={d.id}>
              {nameOf(d)}
            </option>
          ))}
        </select>
      </Field>
      {chosen?.ports?.length > 0 && (
        <Field label="Port (optional in the HLD)">
          <select aria-label="Port on the new device" className={inputClass} value={portId} onChange={(e) => setPortId(e.target.value)}>
            <option value="">Leave to the LLD</option>
            {chosen.ports.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
      )}
      <label className="flex min-h-[40px] items-center gap-2 text-sm text-text">
        <input type="checkbox" className="h-5 w-5" disabled={!connection.cableId} checked={keepCableId} onChange={(e) => setKeepCableId(e.target.checked)} />
        {connection.cableId ? `Keep cable ID ${connection.cableId} (by default a re-terminated run gets a new one)` : 'No cable ID yet'}
      </label>
      <Actions label="Replace endpoint" disabled={!deviceId} busy={busy} onApply={() => onApply({ end, deviceId, ...(portId ? { portId } : {}), ...(keepCableId ? { keepCableId: true } : {}) })} onCancel={onCancel} />
    </>
  )
}

function SplitForm({ connection, devices, rooms, roles, busy, onApply, onCancel }) {
  const [kind, setKind] = useState('new')
  const [deviceId, setDeviceId] = useState('')
  const [role, setRole] = useState(roles.find((r) => r.role === 'distribution')?.role ?? roles[0]?.role ?? '')
  const [roomId, setRoomId] = useState(rooms.find((r) => r.hasRack)?.id ?? rooms[0]?.id ?? '')
  const choices = devices.filter((d) => d.id !== connection.source.deviceId && d.id !== connection.dest.deviceId)
  const ready = kind === 'existing' ? Boolean(deviceId) : Boolean(role && roomId)
  return (
    <>
      <p className="text-xs text-text-secondary">A device goes into the uplink: A — B becomes A — X — B. X needs two free ports for {connection.media.toUpperCase()}; this is checked before anything changes.</p>
      <fieldset className="space-y-1">
        <legend className="text-xs text-text-secondary">Device to insert</legend>
        {[
          ['new', 'A new device'],
          ['existing', 'A device of this design'],
        ].map(([k, label]) => (
          <label key={k} className="flex min-h-[40px] items-center gap-2 text-sm text-text">
            <input type="radio" name="split-kind" className="h-5 w-5" checked={kind === k} onChange={() => setKind(k)} />
            {label}
          </label>
        ))}
      </fieldset>
      {kind === 'existing' ? (
        <Field label="Device">
          <select aria-label="Device to insert" className={inputClass} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Choose a device…</option>
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {nameOf(d)}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Role">
            <select aria-label="Role of the new device" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Room">
            <select aria-label="Room of the new device" className={inputClass} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <Actions label="Split uplink" disabled={!ready} busy={busy} onApply={() => onApply(kind === 'existing' ? { deviceId } : { newDevice: { role, roomId } })} onCancel={onCancel} />
    </>
  )
}

function MergeForm({ device, connections, byId, busy, onApply, onCancel }) {
  const links = connections.filter((c) => c.source.deviceId === device.id || c.dest.deviceId === device.id)
  const far = (c) => byId.get(c.source.deviceId === device.id ? c.dest.deviceId : c.source.deviceId)
  return (
    <>
      <p className="break-all text-xs text-text" data-testid="hld-tool-device">
        {nameOf(device)}
      </p>
      {links.length === 2 ? (
        <p className="break-all text-xs text-text-secondary">
          {nameOf(far(links[0]))} — {nameOf(device)} — {nameOf(far(links[1]))} becomes {nameOf(far(links[0]))} — {nameOf(far(links[1]))}, with a new cable ID. {nameOf(device)} stays in place, unlinked.
        </p>
      ) : (
        <p className="text-xs text-status-amber">Merge joins the two devices either side of a device with exactly two uplinks; this one has {links.length}.</p>
      )}
      <Actions label="Merge" disabled={links.length !== 2} busy={busy} onApply={() => onApply({})} onCancel={onCancel} />
    </>
  )
}
