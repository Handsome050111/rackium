import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const base = (o, p) => `/orgs/${o}/projects/${p}`
const none = (value) => Promise.resolve(value)

// Real mode only (M7a-3): dashboards, workload, analytics and report
// schedules. Mock mode resolves empty values and never touches the network.
export const insightsApi = {
  project: (o, p) => (real ? apiRequest(`${base(o, p)}/dashboard`) : none(null)),
  rollup: (o, p) => (real ? apiRequest(`${base(o, p)}/dashboard/rollup`) : none(null)),
  organisation: (o) => (real ? apiRequest(`/orgs/${o}/dashboard`) : none(null)),
  workload: (o, p) => (real ? apiRequest(`${base(o, p)}/workload`) : none(null)),
  analytics: (o, p) => (real ? apiRequest(`${base(o, p)}/analytics`) : none(null)),
}

export const reportSchedulesApi = {
  list: (o, p) => (real ? apiRequest(`${base(o, p)}/report-schedules`) : none({ schedules: [] })),
  recipients: (o, p) => (real ? apiRequest(`${base(o, p)}/report-schedules/recipients`) : none({ recipients: [] })),
  create: (o, p, body) => (real ? apiRequest(`${base(o, p)}/report-schedules`, { method: 'POST', body }) : none(null)),
  update: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/report-schedules/${id}`, { method: 'PATCH', body }) : none(null)),
  remove: (o, p, id) => (real ? apiRequest(`${base(o, p)}/report-schedules/${id}`, { method: 'DELETE' }) : none(null)),
}
