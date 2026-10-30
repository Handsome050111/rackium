import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)
const idParam = z.object({ id: hex })

// /orgs/:orgId/validation-rules: the organisation's custom rules (M7b-5;
// DATA-MODEL §3.11). Any member reads; the Org Admin writes.
export function orgValidationRuleRoutes({ config, validationRules }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg()]
  const write = requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)
  r.get('/', ...base, async (req, res) => {
    res.json(await validationRules.listOrganisation(req))
  })
  r.post('/', ...base, write, validate({ body: C.validationRuleBody }), async (req, res) => {
    res.status(201).json(await validationRules.createOrganisation(req, req.input.body))
  })
  r.put('/:id', ...base, write, validate({ params: idParam, body: C.validationRuleBody }), async (req, res) => {
    res.json(await validationRules.updateOrganisation(req, req.input.params.id, req.input.body))
  })
  r.patch('/:id/enabled', ...base, write, validate({ params: idParam, body: C.validationRuleEnabledBody }), async (req, res) => {
    res.json(await validationRules.setOrganisationEnabled(req, req.input.params.id, req.input.body))
  })
  r.delete('/:id', ...base, write, validate({ params: idParam }), async (req, res) => {
    res.json(await validationRules.removeOrganisation(req, req.input.params.id))
  })
  return r
}

const loadRoles = async (req, res, next) => {
  if (!req.viewAsActive) req.roles = (await rolesIn(req.user._id, req.org.id, req.project.id)).roles
  next()
}

// /orgs/:orgId/projects/:projectId/validation-rules: what applies to a project
// (any member reads) and its own rules (an Architect writes).
export function projectValidationRuleRoutes({ config, validationRules }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]
  const write = requireAction(ACTIONS.MANAGE_PROJECT_VALIDATION_RULES)
  r.get('/', ...base, async (req, res) => {
    res.json(await validationRules.listProject(req))
  })
  r.post('/preview', ...base, validate({ body: C.validationRulePreviewBody }), async (req, res) => {
    res.json(await validationRules.preview(req, req.input.body))
  })
  r.post('/', ...base, write, validate({ body: C.validationRuleBody }), async (req, res) => {
    res.status(201).json(await validationRules.createProject(req, req.input.body))
  })
  r.put('/:id', ...base, write, validate({ params: idParam, body: C.validationRuleBody }), async (req, res) => {
    res.json(await validationRules.updateProject(req, req.input.params.id, req.input.body))
  })
  r.patch('/:id/enabled', ...base, write, validate({ params: idParam, body: C.validationRuleEnabledBody }), async (req, res) => {
    res.json(await validationRules.setProjectEnabled(req, req.input.params.id, req.input.body))
  })
  r.delete('/:id', ...base, write, validate({ params: idParam }), async (req, res) => {
    res.json(await validationRules.removeProject(req, req.input.params.id))
  })
  return r
}
