import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'

// Organisation-level members and settings (real mode only).
export const organisationApi = {
  members: (orgId) => (real ? apiRequest(`/orgs/${orgId}/members`) : Promise.resolve({ members: [] })),
  setProjectCreation: (orgId, userId, allowed) =>
    real ? apiRequest(`/orgs/${orgId}/members/${userId}/project-creation`, { method: 'PATCH', body: { allowed } }) : Promise.resolve({ userId, canCreateProjects: allowed }),
  settings: (orgId) => (real ? apiRequest(`/orgs/${orgId}/settings`) : Promise.resolve({ settings: { architectsSeePrices: false } })),
  updateSettings: (orgId, settings) => (real ? apiRequest(`/orgs/${orgId}/settings`, { method: 'PATCH', body: settings }) : Promise.resolve({ settings })),
}
