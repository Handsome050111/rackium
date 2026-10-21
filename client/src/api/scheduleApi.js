import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const none = (value) => Promise.resolve(value)
const base = (o, p) => `/orgs/${o}/projects/${p}/schedule`

// Real mode only (M7a-1): the project schedule — targets, milestones,
// dependencies, SLAs. Mock mode resolves empty values, never the network.
export const scheduleApi = {
  view: (o, p) => (real ? apiRequest(base(o, p)) : none(null)),
  setTargets: (o, p, targets) => (real ? apiRequest(`${base(o, p)}/targets`, { method: 'PUT', body: { targets } }) : none(null)),
  updateSettings: (o, p, body) => (real ? apiRequest(`${base(o, p)}/settings`, { method: 'PUT', body }) : none(null)),
  addMilestone: (o, p, body) => (real ? apiRequest(`${base(o, p)}/milestones`, { method: 'POST', body }) : none(null)),
  updateMilestone: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/milestones/${id}`, { method: 'PATCH', body }) : none(null)),
  removeMilestone: (o, p, id) => (real ? apiRequest(`${base(o, p)}/milestones/${id}`, { method: 'DELETE' }) : none(null)),
  setStandardDue: (o, p, body) => (real ? apiRequest(`${base(o, p)}/milestones/standard`, { method: 'PUT', body }) : none(null)),
  addDependency: (o, p, body) => (real ? apiRequest(`${base(o, p)}/dependencies`, { method: 'POST', body }) : none(null)),
  removeDependency: (o, p, id) => (real ? apiRequest(`${base(o, p)}/dependencies/${id}`, { method: 'DELETE' }) : none(null)),
  createSla: (o, p, body) => (real ? apiRequest(`${base(o, p)}/slas`, { method: 'POST', body }) : none(null)),
  updateSla: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/slas/${id}`, { method: 'PATCH', body }) : none(null)),
  removeSla: (o, p, id) => (real ? apiRequest(`${base(o, p)}/slas/${id}`, { method: 'DELETE' }) : none(null)),
  burndown: (o, p, id) => (real ? apiRequest(`${base(o, p)}/slas/${id}/burndown`) : none(null)),
  setAssignees: (o, p, buildingId, body) => (real ? apiRequest(`${base(o, p)}/buildings/${buildingId}/assignees`, { method: 'PATCH', body }) : none(null)),
}
