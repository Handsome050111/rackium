// The name a device is shown by (fix/cmo-naming-gaps): a surveyed item's
// existing label — the name or label recorded on site, e.g. the customer's
// own "VT-A-01" on a patch panel — when set, else its hostname, else what was
// placed (a library item such as "24-port patch panel", or the model).
// The existing label is free text: Rackium enforces no naming convention on
// the customer's gear (brief v2.2 §20.10), so it is never pattern-checked.
// Pure; used by the server views and the client.

export const EXISTING_LABEL_MAX = 120

export function cleanExistingLabel(value) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, EXISTING_LABEL_MAX) : null
}

export function deviceDisplayName(device, fallback = 'Device') {
  return cleanExistingLabel(device?.existingLabel) ?? (device?.hostname || device?.label || device?.model || fallback)
}
