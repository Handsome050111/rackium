import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const none = (value) => Promise.resolve(value)
const orgBase = (o) => `/orgs/${o}/validation-rules`
const projectBase = (o, p) => `/orgs/${o}/projects/${p}/validation-rules`

// Custom validation rules (M7b-5, DATA-MODEL §3.11). Real mode only.
const writes = (base) => ({
  create: (body) => (real ? apiRequest(base, { method: 'POST', body }) : none(null)),
  update: (id, body) => (real ? apiRequest(`${base}/${id}`, { method: 'PUT', body }) : none(null)),
  setEnabled: (id, enabled) => (real ? apiRequest(`${base}/${id}/enabled`, { method: 'PATCH', body: { enabled } }) : none(null)),
  remove: (id) => (real ? apiRequest(`${base}/${id}`, { method: 'DELETE' }) : none(null)),
})

export const validationRulesApi = {
  organisation: (o) => ({ list: () => (real ? apiRequest(orgBase(o)) : none({ rules: [] })), ...writes(orgBase(o)) }),
  project: (o, p) => ({ list: () => (real ? apiRequest(projectBase(o, p)) : none({ organisation: [], project: [], canEdit: false })), ...writes(projectBase(o, p)) }),
  // What a draft rule would flag on one building's design now; nothing is stored.
  preview: (o, p, body) => (real ? apiRequest(`${projectBase(o, p)}/preview`, { method: 'POST', body }) : none(null)),
}
