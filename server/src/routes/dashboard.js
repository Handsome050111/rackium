import { recordingRouter } from '../http/routeRecorder.js'
import { z } from 'zod'
import { requireUser, requireOrg, requireProject, applyViewAs } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'
import { notFound } from '../http/errors.js'
import { requireBuilding, projectScope } from '../access/scope.js'

const buildingIdParam = z.object({ buildingId: z.string().regex(/^[a-f0-9]{24}$/) })

// /orgs/:orgId/projects/:projectId/dashboard/buildings/:buildingId. Read-only
// (client audit 1.1-1.3): any project member or Org Admin may view it, for a
// building within their membership scope (access/scope.js); out of scope is 404.
export function dashboardRoutes({ config, dashboard }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs()]

  r.get('/buildings/:buildingId', ...base, async (req, res, next) => {
    const buildingId = req.params.buildingId
    if (!buildingIdParam.safeParse({ buildingId }).success) return next(notFound())
    await requireBuilding(req, buildingId)
    const scope = await projectScope(req)
    const activePhases = req.project.doc.activePhases ?? []
    const { organisationMembership } = await rolesIn(req.user._id, req.org.id)
    const isOrgAdmin = organisationMembership?.role === 'org_admin'
    res.json(await dashboard.getBuildingDashboard({ buildingId, activePhases, isOrgAdmin, scope }))
  })

  return r
}
