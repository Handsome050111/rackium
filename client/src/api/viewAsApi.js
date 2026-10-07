import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}/view-as`

export const viewAsApi = {
  start: (orgId, projectId, role) => (real ? apiRequest(base(orgId, projectId), { method: 'POST', body: { projectId, role } }) : Promise.resolve({ session: { id: 'mock', viewedRole: role } })),
  end: (orgId, projectId, sessionId) => (real ? apiRequest(`${base(orgId, projectId)}/${sessionId}/end`, { method: 'POST' }) : Promise.resolve({ id: sessionId, ended: true })),
}
