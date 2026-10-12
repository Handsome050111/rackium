import { useState } from 'react'
import { MoveVertical, PackagePlus } from 'lucide-react'

const inputClass = 'h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none disabled:bg-surface-muted'

// Rack elevations on the real API (brief §6.2): the Architect places the
// design's devices by rack, RU and face, and adds patch panels or cable
// managers from the catalogue. The server applies the shared rack rules
// (overlap per face, full depth, boundary, 0U) against surveyed gear and RU
// states, and says why a placement is refused.
export default function LldPlacementPanel({ devices, racks, passiveModels, editable, onPlace, onAdd }) {
  const placeable = devices.filter((d) => d.inDesign && d.rackMounted && d.mounting !== '0U')
  const unplaced = placeable.filter((d) => d.ru == null)
  const [deviceId, setDeviceId] = useState('')
  const [rackId, setRackId] = useState('')
  const [ru, setRu] = useState('')
  const [face, setFace] = useState('front')
  const [modelKey, setModelKey] = useState('')
  // The catalogue row keeps its own rack, RU and face.
  const [addRackId, setAddRackId] = useState('')
  const [addRu, setAddRu] = useState('')
  const [addFace, setAddFace] = useState('front')
  const device = placeable.find((d) => d.id === deviceId)

  function choose(id) {
    setDeviceId(id)
    const d = placeable.find((x) => x.id === id)
    setRackId(d?.rackId ?? racks[0]?.id ?? '')
    setRu(d?.ru ?? '')
    setFace(d?.face ?? 'front')
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="lld-placement">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <MoveVertical size={16} strokeWidth={2} className="text-brand" />
        Place devices
      </div>
      {unplaced.length > 0 ? (
        <p className="text-xs text-status-amber">
          Not placed yet: {unplaced.map((d) => d.label).join(', ')}
        </p>
      ) : (
        <p className="text-xs text-text-secondary">Every rack-mounted device has a rack and RU.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          <span className="text-text-secondary">Device</span>
          <select aria-label="Device to place" value={deviceId} onChange={(e) => choose(e.target.value)} disabled={!editable} className={`${inputClass} max-w-[16rem]`}>
            <option value="">Choose…</option>
            {placeable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
                {d.ru != null ? ` (${d.rackCode} RU${d.ru} ${d.face})` : ' (not placed)'}
              </option>
            ))}
          </select>
        </label>
        <RackRuFace racks={racks} rackId={rackId} setRackId={setRackId} ru={ru} setRu={setRu} face={face} setFace={setFace} disabled={!editable || !device} />
        <button type="button" disabled={!editable || !device || !rackId || ru === ''} onClick={() => onPlace(device.id, { rackId, ru: Number(ru), face })} className="h-9 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 disabled:bg-status-grey">
          Place
        </button>
        {device?.ru != null && (
          <button type="button" disabled={!editable} onClick={() => onPlace(device.id, { rackId: device.rackId, ru: null, face: device.face })} className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand">
            Unplace
          </button>
        )}
      </div>

      {editable && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="flex min-w-0 flex-col gap-1 text-xs">
            <span className="flex items-center gap-1 text-text-secondary">
              <PackagePlus size={12} strokeWidth={2} />
              Add from catalogue
            </span>
            <select aria-label="Passive item" value={modelKey} onChange={(e) => setModelKey(e.target.value)} className={`${inputClass} max-w-[16rem]`}>
              <option value="">Patch panel or cable manager…</option>
              {passiveModels.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.model}
                </option>
              ))}
            </select>
          </label>
          <RackRuFace racks={racks} rackId={addRackId} setRackId={setAddRackId} ru={addRu} setRu={setAddRu} face={addFace} setFace={setAddFace} disabled={!modelKey} />
          <button type="button" disabled={!modelKey || !addRackId || addRu === ''} onClick={() => onAdd({ catalogueKey: modelKey, rackId: addRackId, ru: Number(addRu), face: addFace })} className="h-9 rounded-lg border border-brand px-3 text-xs font-medium text-brand hover:bg-brand/5 disabled:border-border disabled:text-text-secondary">
            Add to rack
          </button>
        </div>
      )}
    </div>
  )
}

function RackRuFace({ racks, rackId, setRackId, ru, setRu, face, setFace, disabled }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-text-secondary">Rack</span>
        <select aria-label="Rack" value={rackId} onChange={(e) => setRackId(e.target.value)} disabled={disabled} className={inputClass}>
          <option value="">—</option>
          {racks.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-text-secondary">RU</span>
        <input aria-label="RU" type="number" min="1" max="60" value={ru} onChange={(e) => setRu(e.target.value)} disabled={disabled} className={`${inputClass} w-16`} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-text-secondary">Face</span>
        <select aria-label="Face" value={face} onChange={(e) => setFace(e.target.value)} disabled={disabled} className={inputClass}>
          <option value="front">Front</option>
          <option value="rear">Rear</option>
        </select>
      </label>
    </>
  )
}
