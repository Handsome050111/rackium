// Pure helpers for the real-mode survey screens (unit-tested).

export const surveyPath = (orgId, projectId, buildingId, rest = '') => `/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}/survey${rest}`

export function stepperLinksFor(orgId, projectId, buildingId, firstRackId) {
  return {
    'site-structure': surveyPath(orgId, projectId, buildingId),
    'room-details': surveyPath(orgId, projectId, buildingId, '/room'),
    'rack-survey': firstRackId ? surveyPath(orgId, projectId, buildingId, `/rack?rack=${firstRackId}`) : undefined,
    'building-connections': surveyPath(orgId, projectId, buildingId, '/campus'),
    validation: surveyPath(orgId, projectId, buildingId, '?panel=validation'),
  }
}

// A stored survey value as a short readable string (conflict reports).
export function formatValue(v) {
  if (v == null || v === '') return '—'
  if (typeof v === 'object') return v.fileIds ? `${v.fileIds.length} file(s)` : JSON.stringify(v)
  return String(v)
}

// Rack placements → the API body. Identity travels only when the screen set
// it (omitted = keep what the device has); an imported CMO device's serial
// is never sent back. RU states are not placements (they have their own calls).
export function toPlacementBody(placements) {
  return placements
    .filter((p) => p.kind === 'device')
    .map((p) => ({
      deviceId: p.deviceId ?? p.id,
      ru: p.mounting === '0U' ? 0 : p.ru,
      heightU: p.mounting === '0U' ? 0 : p.heightU,
      face: p.face,
      fullDepth: Boolean(p.fullDepth),
      mounting: p.mounting ?? 'rack',
      railSide: p.mounting === '0U' ? p.railSide ?? 'left' : null,
      category: p.category ?? null,
      label: p.label,
      sublabel: p.sublabel ?? null,
      ...(p.identityEdited && !p.fromCmo ? { serial: p.serial || null, mac: p.mac || null } : {}),
    }))
}

// The PATCH body for one changed rack fact (PDU sockets travel as a pair).
// Returns null for an invalid number.
export function factPatch(meta, group, key, raw, number) {
  const value = raw === '' ? null : number ? Number(raw) : raw
  if (number && value !== null && (!Number.isInteger(value) || value < 0)) return null
  if (key.includes('.')) {
    const [pdu, part] = key.split('.')
    const current = meta[group]?.[pdu] ?? {}
    const next = { totalSockets: current.totalSockets ?? 0, freeSockets: current.freeSockets ?? 0, [part]: value ?? 0 }
    return { [group]: { [pdu]: next } }
  }
  return { [group]: { [key]: value } }
}

// The room panel (prototype) speaks hyphens; the API underscores.
export const toPanelValue = (v) => (v ? v.replace(/_/g, '-') : v)
export const toApiValue = (v) => (v ? v.replace(/-/g, '_') : v)
