import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)

// /orgs/:orgId/projects/:projectId — M7a-3 (brief v2.2 §21.5, §21.6, §21.9):
// the project dashboard and its country/SAL rollup, the workload matrix,
// analytics and the report schedules. Every project member reads the
// dashboards and analytics over the buildings of their scope; the workload
// (figures per person) and the schedules are the Org Admin's and the PM's
// (403 for anyone else, 404 outside the project as everywhere).
export function insightRoutes({ config, insights, reportSchedules }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs()]
  const people = requireAction(ACTIONS.VIEW_PERSON_METRICS)
  const schedules = requireAction(ACTIONS.MANAGE_REPORT_SCHEDULES)

  r.get('/dashboard', ...base, async (req, res) => {
    res.json(await insights.project(req))
  })
  r.get('/dashboard/rollup', ...base, async (req, res) => {
    res.json(await insights.rollup(req))
  })
  r.get('/workload', ...base, people, async (req, res) => {
    res.json(await insights.workload(req))
  })
  r.get('/analytics', ...base, async (req, res) => {
    res.json(await insights.analytics(req))
  })

  r.get('/report-schedules', ...base, schedules, async (req, res) => {
    res.json(await reportSchedules.list(req))
  })
  r.get('/report-schedules/recipients', ...base, schedules, async (req, res) => {
    res.json(await reportSchedules.recipients(req))
  })
  r.post('/report-schedules', ...base, schedules, validate({ body: C.reportScheduleBody }), async (req, res) => {
    res.status(201).json(await reportSchedules.create(req, req.input.body, actorOf(req)))
  })
  r.patch('/report-schedules/:id', ...base, schedules, validate({ params: z.object({ id: hex }), body: C.reportScheduleUpdateBody }), async (req, res) => {
    res.json(await reportSchedules.update(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.delete('/report-schedules/:id', ...base, schedules, validate({ params: z.object({ id: hex }) }), async (req, res) => {
    res.json(await reportSchedules.remove(req, req.input.params.id, actorOf(req)))
  })
  return r
}

// /orgs/:orgId/dashboard — the organisation-level dashboard: the Org Admin
// sees every project, anyone else the projects they are a member of.
export function orgInsightRoutes({ config, insights }) {
  const r = recordingRouter({ mergeParams: true })
  r.get('/dashboard', requireUser(config), requireOrg(), async (req, res) => {
    res.json(await insights.organisation(req))
  })
  return r
}
