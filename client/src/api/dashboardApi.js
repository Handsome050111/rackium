import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'

export const dashboardApi = {
  getBuildingDashboard: (orgId, projectId, buildingId) =>
    real
      ? apiRequest(`/orgs/${orgId}/projects/${projectId}/dashboard/buildings/${buildingId}`)
      : Promise.resolve({ building: null, phases: [], kpis: { devices: 0, connections: 0, openIssues: 0, completionPercent: 0 }, blockers: [], recentActivity: [] }),
}
