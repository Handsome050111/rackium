import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}/blockers`

export const blockersApi = {
  listForBuilding: (orgId, projectId, buildingId) =>
    real ? apiRequest(`${base(orgId, projectId)}?buildingId=${buildingId}`) : Promise.resolve({ blockers: [] }),
  raise: (orgId, projectId, body) => (real ? apiRequest(base(orgId, projectId), { method: 'POST', body }) : Promise.resolve({ blocker: null })),
  update: (orgId, projectId, id, body) => (real ? apiRequest(`${base(orgId, projectId)}/${id}`, { method: 'PATCH', body }) : Promise.resolve({ blocker: null })),
}
