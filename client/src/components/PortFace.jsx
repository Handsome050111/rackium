function Port({ port, isOccupied, isSelected, onSelect, disabled }) {
  const base = 'flex h-7 min-w-7 items-center justify-center rounded border text-[10px] font-medium'
  let stateClass = 'border-border bg-surface text-text-secondary hover:border-brand/50'
  if (isOccupied) stateClass = 'border-status-grey bg-surface-muted text-text-secondary'
  if (isSelected) stateClass = 'border-brand bg-brand/10 text-brand ring-2 ring-brand/30'

  return (
    <button
      type="button"
      disabled={disabled || isOccupied}
      onClick={() => onSelect(port)}
      title={isOccupied ? `${port.label} — occupied` : port.label}
      className={`${base} ${stateClass} ${isOccupied ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {port.label.length > 4 ? port.n : port.label}
    </button>
  )
}

// `selectedPortId` drives BOTH the highlighted cell and the caption below —
// there is no second, independently-typed "Port X selected" string, so the
// two can never disagree (the render's page-15 mistake: highlight on 08,
// caption reading "Port 09 selected").
export default function PortFace({ title, sublabel, portMap, occupiedPortIds = [], selectedPortId, onSelectPort, disabled }) {
  const occupied = new Set(occupiedPortIds)
  const allPorts = [...portMap.rows.flat(), ...portMap.modulePorts]
  const selectedPort = allPorts.find((p) => p.id === selectedPortId) ?? null

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-1 text-sm font-semibold text-text">{title}</div>
      {sublabel && <div className="mb-3 text-xs text-text-secondary">{sublabel}</div>}

      <div className="flex flex-wrap items-start gap-4 overflow-x-auto">
        <div className="flex min-w-max flex-col gap-1">
          {portMap.rows.map((row, i) => (
            <div key={i} className="flex gap-1">
              {row.map((port) => (
                <Port
                  key={port.id}
                  port={port}
                  isOccupied={occupied.has(port.id)}
                  isSelected={port.id === selectedPortId}
                  onSelect={(p) => onSelectPort(p.id)}
                  disabled={disabled}
                />
              ))}
            </div>
          ))}
        </div>

        {portMap.modulePorts.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
              Uplink module ({portMap.modulePorts.length} ports)
            </div>
            <div className="flex flex-wrap gap-1" style={{ maxWidth: 160 }}>
              {portMap.modulePorts.map((port) => (
                <Port
                  key={port.id}
                  port={port}
                  isOccupied={occupied.has(port.id)}
                  isSelected={port.id === selectedPortId}
                  onSelect={(p) => onSelectPort(p.id)}
                  disabled={disabled}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 text-xs text-text-secondary">
        {selectedPort ? (
          <span className="font-medium text-brand">{selectedPort.label} selected</span>
        ) : (
          'No port selected'
        )}
      </div>
    </div>
  )
}
