import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'

// Real mode only — mock mode has no organisation/project backend, so every
// call resolves to an empty shape rather than hitting the network, matching
// authApi.js's own mode split.
export const projectsApi = {
  list: (orgId) => (real ? apiRequest(`/orgs/${orgId}/projects`) : Promise.resolve({ projects: [] })),
  get: (orgId, projectId) => (real ? apiRequest(`/orgs/${orgId}/projects/${projectId}`) : Promise.resolve({ project: null })),
  create: (orgId, body) => (real ? apiRequest(`/orgs/${orgId}/projects`, { method: 'POST', body }) : Promise.resolve({ project: { id: 'mock' } })),
  update: (orgId, projectId, body) => (real ? apiRequest(`/orgs/${orgId}/projects/${projectId}`, { method: 'PATCH', body }) : Promise.resolve({ project: null })),
}
