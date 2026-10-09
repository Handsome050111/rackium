import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}/survey`
const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return s ? `?${s}` : ''
}
const none = (value) => Promise.resolve(value)

// Real mode only (M3b): site structure, pathways, rack survey and survey
// forms on the backend. Mock mode's survey screens keep using
// api/siteStructure.js, api/survey.js and api/surveyFormsDesign.js.
export const surveyApi = {
  structure: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/buildings/${buildingId}/structure`) : none({ buildings: [], pathways: [], findings: [] })),
  campusStructure: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/buildings/${buildingId}/campus-structure`) : none({ buildings: [], pathways: [], findings: [] })),
  createFloor: (o, p, body) => (real ? apiRequest(`${base(o, p)}/floors`, { method: 'POST', body }) : none({ floor: null })),
  createRoom: (o, p, body) => (real ? apiRequest(`${base(o, p)}/rooms`, { method: 'POST', body }) : none({ room: null })),
  createRack: (o, p, body) => (real ? apiRequest(`${base(o, p)}/racks`, { method: 'POST', body }) : none({ rack: null })),
  updateRoomSurvey: (o, p, roomId, body) => (real ? apiRequest(`${base(o, p)}/rooms/${roomId}/survey`, { method: 'PATCH', body }) : none(null)),

  createPathway: (o, p, body) => (real ? apiRequest(`${base(o, p)}/pathways`, { method: 'POST', body }) : none({ pathway: null })),
  updatePathway: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/pathways/${id}`, { method: 'PATCH', body }) : none({ pathway: null })),
  deletePathway: (o, p, id) => (real ? apiRequest(`${base(o, p)}/pathways/${id}`, { method: 'DELETE' }) : none(null)),

  rack: (o, p, rackId) => (real ? apiRequest(`${base(o, p)}/racks/${rackId}`) : none(null)),
  savePlacements: (o, p, rackId, placements) => (real ? apiRequest(`${base(o, p)}/racks/${rackId}/placements`, { method: 'PATCH', body: { placements } }) : none(null)),
  saveVersion: (o, p, rackId) => (real ? apiRequest(`${base(o, p)}/racks/${rackId}/versions`, { method: 'POST' }) : none(null)),
  updateFacts: (o, p, rackId, body) => (real ? apiRequest(`${base(o, p)}/racks/${rackId}/facts`, { method: 'PATCH', body }) : none(null)),
  setRuState: (o, p, rackId, body) => (real ? apiRequest(`${base(o, p)}/racks/${rackId}/ru-states`, { method: 'POST', body }) : none(null)),
  releaseRuState: (o, p, rackId, stateId) => (real ? apiRequest(`${base(o, p)}/racks/${rackId}/ru-states/${stateId}`, { method: 'DELETE' }) : none(null)),

  record: (o, p, { buildingId, roomId, tab }) => (real ? apiRequest(`${base(o, p)}/records${q({ buildingId, roomId, tab })}`) : none({ record: null })),
  edit: (o, p, { buildingId, roomId, tab, op, baseLastModifiedAt }) =>
    real ? apiRequest(`${base(o, p)}/records/edits`, { method: 'POST', body: { buildingId, roomId: roomId ?? null, tab, op, baseLastModifiedAt } }) : none(null),
  transition: (o, p, { buildingId, roomId, tab, action, reason }) =>
    real ? apiRequest(`${base(o, p)}/records/transitions`, { method: 'POST', body: { buildingId, roomId: roomId ?? null, tab, action, reason: reason ?? '' } }) : none(null),
  progress: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/buildings/${buildingId}/progress`) : none(null)),
  importBuilding: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/import`, { method: 'POST', body: { buildingId } }) : none(null)),
  checkSerial: (o, p, buildingId, serial) => (real ? apiRequest(`${base(o, p)}/serials/check${q({ buildingId, serial })}`) : none({ status: 'not-in-cmo' })),
  customFields: (o, p, tab) => (real ? apiRequest(`${base(o, p)}/custom-fields${q({ tab })}`) : none({ customFields: [] })),
  addCustomField: (o, p, body) => (real ? apiRequest(`${base(o, p)}/custom-fields`, { method: 'POST', body }) : none(null)),
  sync: (o, p, edits) => (real ? apiRequest(`${base(o, p)}/sync`, { method: 'POST', body: { edits } }) : none({ results: [] })),
}
