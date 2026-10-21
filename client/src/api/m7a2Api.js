import { API_MODE } from '../lib/apiMode.js'
import { apiRequest, API_BASE } from './httpClient.js'
import { getViewAsSession } from '../lib/viewAsSession.js'

const real = API_MODE === 'real'
const none = (value) => Promise.resolve(value)
const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  const text = s.toString()
  return text ? `?${text}` : ''
}

// Real mode only (M7a-2): global search, DGUV dashboards, field help. Mock
// mode resolves empty values and never touches the network.
export const searchApi = {
  // Inside a project being viewed with View As, the search is that view's.
  search: (o, q, projectId = null) => {
    if (!real) return none({ results: [] })
    const viewAs = getViewAsSession()
    const headers = viewAs && projectId && String(viewAs.projectId) === String(projectId) ? { 'X-View-As-Session': viewAs.id } : {}
    return apiRequest(`/orgs/${o}/search${qs({ q, projectId })}`, { headers })
  },
}

export const dguvApi = {
  view: (o, p, query = {}) => (real ? apiRequest(`/orgs/${o}/projects/${p}/dguv${qs(query)}`) : none(null)),
  devices: (o, p, query = {}) => (real ? apiRequest(`/orgs/${o}/projects/${p}/dguv/devices${qs(query)}`) : none({ devices: [] })),
  exportUrl: (o, p, query = {}) => `${API_BASE}/orgs/${o}/projects/${p}/dguv/export.csv${qs(query)}`,
}

export const fieldHelpApi = {
  list: (o, prefix = 'survey:') => (real ? apiRequest(`/orgs/${o}/field-help${qs({ prefix })}`) : none({ fields: [] })),
  update: (o, key, body) => (real ? apiRequest(`/orgs/${o}/field-help/${encodeURIComponent(key)}`, { method: 'PUT', body }) : none(null)),
  reset: (o, key) => (real ? apiRequest(`/orgs/${o}/field-help/${encodeURIComponent(key)}`, { method: 'DELETE' }) : none(null)),
  addPhoto: (o, key, file, caption = null) => (real ? apiRequest(`/orgs/${o}/field-help/${encodeURIComponent(key)}/photos${qs({ caption })}`, { method: 'POST', body: file }) : none(null)),
  removePhoto: (o, key, photoId) => (real ? apiRequest(`/orgs/${o}/field-help/${encodeURIComponent(key)}/photos/${photoId}`, { method: 'DELETE' }) : none(null)),
}
