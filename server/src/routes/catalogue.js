import mongoose from 'mongoose'
import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS, can } from '@rackium/shared/policy.js'
import { catalogueItemBody, catalogueQuery, catalogueItemQuery, catalogueImportBody } from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireAction, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'
import { Project } from '../models/project.js'
import { notFound } from '../http/errors.js'

const idParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) })

// Who sees prices (brief v2.3 §4.3, ACTIONS.SEE_PRICES_MARGINS): decided from
// the organisation role plus, when browsing from a project, the role in that
// project. A projectId the caller cannot open is a 404, like everywhere else.
async function viewContext(req, projectId) {
  if (projectId) {
    if (!mongoose.isValidObjectId(projectId) || !(await Project.exists({ _id: projectId }))) throw notFound()
  }
  const { roles } = await rolesIn(req.user._id, req.org.id, projectId ?? null)
  const hasProjectAccess = !projectId || roles.length > 0
  if (!hasProjectAccess) throw notFound()
  return { projectId: projectId ?? null, showPrices: can(roles, ACTIONS.SEE_PRICES_MARGINS) }
}

// /orgs/:orgId/catalogue. Any member of the organisation may browse;
// only an Org Admin adds, edits or imports organisation items (brief §4.3,
// "Manage ... catalogue").
export function catalogueRoutes({ config, catalogue }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg()]
  const manage = requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)

  r.get('/', ...base, validate({ query: catalogueQuery }), async (req, res) => {
    const { projectId, ...filters } = req.input.query
    const view = await viewContext(req, projectId)
    res.json({ ...(await catalogue.list({ projectId: view.projectId, filters, showPrices: view.showPrices })), pricesVisible: view.showPrices })
  })

  r.post('/import', ...base, manage, validate({ body: catalogueImportBody }), async (req, res) => {
    res.status(201).json({ imported: await catalogue.importRows({ organisationId: req.org.id, actor: actorOf(req), rows: req.input.body.rows }) })
  })

  r.get('/:id', ...base, validate({ params: idParam, query: catalogueItemQuery }), async (req, res) => {
    const view = await viewContext(req, req.input.query.projectId)
    res.json({ ...(await catalogue.get({ id: req.input.params.id, projectId: view.projectId, showPrices: view.showPrices })), pricesVisible: view.showPrices })
  })

  r.post('/', ...base, manage, validate({ body: catalogueItemBody }), async (req, res) => {
    res.status(201).json({ item: await catalogue.create({ organisationId: req.org.id, actor: actorOf(req), body: req.input.body }) })
  })

  // The whole item is sent (same body as create), so the shared rules
  // re-check every field together.
  r.patch('/:id', ...base, manage, validate({ params: idParam, body: catalogueItemBody }), async (req, res) => {
    res.json({ item: await catalogue.replace({ organisationId: req.org.id, actor: actorOf(req), id: req.input.params.id, body: req.input.body }) })
  })

  return r
}
