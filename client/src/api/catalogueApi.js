import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const base = (orgId) => `/orgs/${orgId}/catalogue`

function queryString(params) {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '' && value !== false) q.set(key, String(value))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

// Real mode only — the mock catalogue (mock/deviceCatalogue.js) is read
// directly by the prototype's own screens, so mock mode resolves to empty
// shapes here, like the other *Api.js modules.
export const catalogueApi = {
  list: (orgId, params) => (real ? apiRequest(`${base(orgId)}${queryString(params)}`) : Promise.resolve({ items: [], vendors: [], total: 0, pricesVisible: false })),
  get: (orgId, id, params) => (real ? apiRequest(`${base(orgId)}/${id}${queryString(params)}`) : Promise.resolve({ item: null, ports: [], layers: [], effectiveId: null, pricesVisible: false })),
  create: (orgId, item) => (real ? apiRequest(base(orgId), { method: 'POST', body: item }) : Promise.resolve({ item: null })),
  replace: (orgId, id, item) => (real ? apiRequest(`${base(orgId)}/${id}`, { method: 'PATCH', body: item }) : Promise.resolve({ item: null })),
  import: (orgId, rows) => (real ? apiRequest(`${base(orgId)}/import`, { method: 'POST', body: { rows } }) : Promise.resolve({ imported: { created: 0, updated: 0 } })),
}
