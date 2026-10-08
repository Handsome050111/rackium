import { CMO_FIELDS } from '@rackium/shared/cmoModel.js'
import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}/cmo`

// Only the mapped fields go back to the server (it re-validates them); the
// preview's own annotations are dropped.
export function toCmoRows(rows) {
  return rows.map((r) => ({ rowIndex: r.rowIndex, ...Object.fromEntries(CMO_FIELDS.map((f) => [f.key, r[f.key] ?? null])) }))
}

// Real mode only; mock mode's CMO screen uses api/cmoDesign.js.
export const cmoApi = {
  context: (orgId, projectId) =>
    real ? apiRequest(base(orgId, projectId)) : Promise.resolve({ sals: [], buildings: [], devices: [], kpis: { total: 0, assigned: 0, unassigned: 0 }, lastImportAt: null }),
  preview: (orgId, projectId, { rows, salId }) =>
    real ? apiRequest(`${base(orgId, projectId)}/preview`, { method: 'POST', body: { rows: toCmoRows(rows), salId } }) : Promise.resolve({ rows: [], summary: null }),
  commit: (orgId, projectId, { rows, salId, fileName }) =>
    real ? apiRequest(`${base(orgId, projectId)}/import`, { method: 'POST', body: { rows: toCmoRows(rows), salId, fileName } }) : Promise.resolve({ summary: null }),
  assign: (orgId, projectId, deviceId, buildingId) =>
    real ? apiRequest(`${base(orgId, projectId)}/devices/${deviceId}/assignment`, { method: 'PATCH', body: { buildingId } }) : Promise.resolve({ device: null }),
}
