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

// A renamed device keeps its old name (DATA-MODEL §5.19, addendum v2.3 Q5):
// shown as "old → new" wherever it appears, because on site it is found by
// the old name. The plain name when there is no old one, or it is the same.
export const LEGACY_ARROW = ' → '
export function withLegacyName(name, legacyHostname) {
  const legacy = String(legacyHostname ?? '').trim()
  return legacy && legacy !== name ? `${legacy}${LEGACY_ARROW}${name}` : name
}
