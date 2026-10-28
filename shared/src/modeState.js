// Mode states (DATA-MODEL §5.21; addendum v2.3 §2 Q5, §13, §14): one field
// on a device or connection, never three tables. Rackium stores its own
// values — `current`, `interim`, `future` — and the client's words for them
// (CMO / IMO / FMO by default; As-Is / Transition / To-Be for another) are
// configuration: an organisation default, overridden per project.
export const MODE_STATES = ['current', 'interim', 'future']
export const DEFAULT_MODE_LABELS = { current: 'CMO', interim: 'IMO', future: 'FMO' }
export const MODE_LABEL_MAX = 24
// What happens to an existing (CMO) device in the future design.
export const CMO_DECISIONS = ['keep', 'replace', 'remove']
// The canvas: each state shown, drawn as an overlay (ghost) or hidden.
export const MODE_VIEWS = ['show', 'overlay', 'hide']
export const DEFAULT_MODE_VIEW = { current: 'hide', interim: 'show', future: 'show' }

// A record's mode. Rows from before M7b-4 carry none: imported and surveyed
// gear is `current`, designed gear `future`.
export function modeOf(record) {
  if (MODE_STATES.includes(record?.modeState)) return record.modeState
  return record?.origin === 'existing' ? 'current' : 'future'
}

// The labels in force: the defaults, then each layer's non-empty overrides
// (organisation, then project).
export function resolveModeLabels(...layers) {
  const out = { ...DEFAULT_MODE_LABELS }
  for (const layer of layers) {
    for (const state of MODE_STATES) {
      const value = typeof layer?.[state] === 'string' ? layer[state].trim() : ''
      if (value) out[state] = value
    }
  }
  return out
}

// An imported CMO device (the CMO list), as opposed to a surveyed generic
// item (a shelf, a patch panel) — only these get a decision.
export const isCmoDevice = (device) => device?.origin === 'existing' && Boolean(device.importBatchId ?? device.cmo)

// Is a device part of the future design? Designed gear in the future state is;
// interim kit never is; existing gear is when kept (decided, or already
// applied at LLD approval). `null`: an existing device with no decision yet.
export function inFuture(device) {
  const mode = modeOf(device)
  if (device?.origin !== 'existing') return mode === 'future'
  if (mode === 'future') return true
  const decision = device?.cmoDecision?.decision ?? null
  if (!decision) return isCmoDevice(device) ? null : true
  return decision === 'keep'
}

// The states a device appears in on the canvas: existing gear is current, and
// future too when kept; designed gear is in its own state.
export function modeStatesOf(device) {
  if (device?.origin !== 'existing') return [modeOf(device)]
  return inFuture(device) === true ? ['current', 'future'] : ['current']
}

// Which devices and links the canvas draws for a view ({ current, interim,
// future } → show | overlay | hide): a device is solid when any of its states
// is shown, a ghost when one is overlaid, else hidden. A link needs both ends
// drawn, and is a ghost when its state is overlaid or an end is a ghost.
export function applyModeView({ devices = [], connections = [] }, view = DEFAULT_MODE_VIEW) {
  const how = (state) => (MODE_VIEWS.includes(view?.[state]) ? view[state] : DEFAULT_MODE_VIEW[state])
  const drawn = new Map()
  for (const d of devices) {
    const states = modeStatesOf(d).map(how)
    const look = states.includes('show') ? 'show' : states.includes('overlay') ? 'overlay' : null
    if (look) drawn.set(String(d.id), look)
  }
  return {
    devices: devices.filter((d) => drawn.has(String(d.id))).map((d) => ({ ...d, ghost: drawn.get(String(d.id)) === 'overlay' })),
    connections: connections
      .filter((c) => how(modeOf(c)) !== 'hide' && drawn.has(String(c.source.deviceId)) && drawn.has(String(c.dest.deviceId)))
      .map((c) => ({ ...c, ghost: how(modeOf(c)) === 'overlay' || drawn.get(String(c.source.deviceId)) === 'overlay' || drawn.get(String(c.dest.deviceId)) === 'overlay' })),
  }
}

// The line a CMO device shows under its name: its decision.
export function decisionText(decision, labels = DEFAULT_MODE_LABELS) {
  if (!decision) return 'No decision yet'
  if (decision.decision === 'keep') return decision.hostname ? `Keep → ${decision.hostname}` : `Keep in the ${labels.future}`
  if (decision.decision === 'replace') return `Replaced by ${decision.replacedByName ?? 'a device no longer in the design'}`
  return `Remove (${labels.current} only)`
}
