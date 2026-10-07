import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}/hierarchy`
const emptyTree = { countries: [], sals: [], campuses: [], buildings: [], wings: [], floors: [], rooms: [], racks: [] }

function entity(path) {
  return {
    create: (orgId, projectId, body) => (real ? apiRequest(`${base(orgId, projectId)}/${path}`, { method: 'POST', body }) : Promise.resolve({ [path]: null })),
    update: (orgId, projectId, id, body) => (real ? apiRequest(`${base(orgId, projectId)}/${path}/${id}`, { method: 'PATCH', body }) : Promise.resolve({ [path]: null })),
    remove: (orgId, projectId, id) => (real ? apiRequest(`${base(orgId, projectId)}/${path}/${id}`, { method: 'DELETE' }) : Promise.resolve({ id, deleted: true })),
  }
}

export const hierarchyApi = {
  tree: (orgId, projectId) => (real ? apiRequest(base(orgId, projectId)) : Promise.resolve({ tree: emptyTree })),
  import: (orgId, projectId, rows) => (real ? apiRequest(`${base(orgId, projectId)}/import`, { method: 'POST', body: { rows } }) : Promise.resolve({ imported: {} })),
  countries: entity('countries'),
  sals: entity('sals'),
  campuses: entity('campuses'),
  buildings: entity('buildings'),
  wings: entity('wings'),
  floors: entity('floors'),
  rooms: entity('rooms'),
  racks: entity('racks'),
}
