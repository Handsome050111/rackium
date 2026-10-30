import { ACTIONS, rolesAllowed } from '@rackium/shared/policy.js'
import { customRuleFindings, ruleObject, ruleField, OPERATOR_LABEL } from '@rackium/shared/customRules.js'
import { ValidationRule } from '../models/validationRule.js'
import { LldDesign } from '../models/lldDesign.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { conflict, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'

// Custom validation rules (M7b-5; DATA-MODEL §3.11, D11). The Org Admin writes
// the organisation's, an Architect covering the whole project writes its own;
// every member reads what applies. A change takes effect at the next
// validation: nothing stored is reopened.

const valueOf = (r) => r.valueList ?? r.valueNumber ?? r.valueBoolean ?? r.valueString ?? null
const typed = (value) => ({
  valueString: typeof value === 'string' ? value : null,
  valueNumber: typeof value === 'number' ? value : null,
  valueBoolean: typeof value === 'boolean' ? value : null,
  valueList: Array.isArray(value) ? value : undefined,
})
const view = (r) => ({
  id: String(r._id),
  scope: r.scope,
  name: r.name,
  object: r.object,
  subjectRole: r.subjectRole ?? null,
  field: r.field,
  operator: r.operator,
  value: valueOf(r),
  severity: r.severity,
  message: r.message ?? null,
  enabled: r.enabled !== false,
  updatedAt: r.updatedAt,
})
// The rule in words, for the audit log.
const summary = (r) => {
  const field = ruleField(r.object, r.field)?.label ?? r.field
  const value = r.value == null ? '' : ` ${Array.isArray(r.value) ? r.value.join(', ') : r.value}`
  return `${r.severity}: ${ruleObject(r.object)?.label ?? r.object}${r.subjectRole ? ` (${r.subjectRole})` : ''} ${field} ${OPERATOR_LABEL[r.operator]}${value}`
}

// The rules a design is validated against: the organisation's and the
// project's, enabled. Runs in the project's tenant scope.
export async function rulesInForce(session = null) {
  const { projectId } = currentScope()
  const rows = await ValidationRule.find({ enabled: true, $or: [{ projectId: null }, { projectId }] }).sort({ createdAt: 1 }).session(session).lean()
  return rows.map(view)
}

export function createValidationRuleService({ hld, lld }) {
  const audit = (req, action, rule, extra = {}) =>
    recordAudit({ organisationId: req.org.id, ...(rule.projectId ? { projectId: req.project.id } : {}), actor: userActor(req.user._id, req.roles?.[0]), action, objectType: 'ValidationRule', objectId: String(rule._id), changeType: 'design_intent', source: 'ui', comment: `${rule.name} — ${summary(view(rule))}`, ...extra })

  const fieldsOf = (body) => ({
    name: body.name,
    object: body.object,
    subjectRole: body.subjectRole ?? null,
    field: body.field,
    operator: body.operator,
    ...typed(body.value ?? null),
    severity: body.severity,
    message: body.message || null,
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
  })
  const duplicate = (err, name) => {
    if (err?.code === 11000) return conflict('duplicate_name', `There is already a rule named ${name} here`)
    return err
  }
  // The rule of this level; another level's or organisation's is not found.
  async function ruleAt(ruleId, projectId) {
    const rule = await ValidationRule.findOne({ _id: ruleId, projectId }).lean()
    if (!rule) throw notFound('Rule not found')
    return rule
  }

  async function create(req, body, level) {
    try {
      const [rule] = await ValidationRule.create([{ ...fieldsOf(body), scope: level.scope, projectId: level.projectId, createdBy: req.user._id, updatedBy: req.user._id }])
      await audit(req, 'validation_rule.created', rule)
      return { rule: view(rule) }
    } catch (err) {
      throw duplicate(err, body.name)
    }
  }
  async function update(req, ruleId, body, level) {
    const before = await ruleAt(ruleId, level.projectId)
    const next = fieldsOf(body)
    // A list value is unset when the new value is not a list.
    const update = { $set: { ...next, valueList: next.valueList ?? null, updatedBy: req.user._id, updatedAt: new Date() } }
    if (!next.valueList) {
      delete update.$set.valueList
      update.$unset = { valueList: 1 }
    }
    try {
      await ValidationRule.updateOne({ _id: before._id, projectId: level.projectId }, update)
    } catch (err) {
      throw duplicate(err, body.name)
    }
    const rule = await ruleAt(ruleId, level.projectId)
    await audit(req, 'validation_rule.updated', rule, { changes: [{ objectType: 'ValidationRule', objectId: String(rule._id), field: 'rule', before: summary(view(before)), after: summary(view(rule)) }] })
    return { rule: view(rule) }
  }
  async function setEnabled(req, ruleId, { enabled }, level) {
    const before = await ruleAt(ruleId, level.projectId)
    await ValidationRule.updateOne({ _id: before._id, projectId: level.projectId }, { $set: { enabled, updatedBy: req.user._id, updatedAt: new Date() } })
    const rule = await ruleAt(ruleId, level.projectId)
    if (before.enabled !== rule.enabled) await audit(req, enabled ? 'validation_rule.enabled' : 'validation_rule.disabled', rule, { changes: [{ objectType: 'ValidationRule', objectId: String(rule._id), field: 'enabled', before: before.enabled, after: rule.enabled }] })
    return { rule: view(rule) }
  }
  async function remove(req, ruleId, level) {
    const rule = await ruleAt(ruleId, level.projectId)
    await ValidationRule.deleteOne({ _id: rule._id, projectId: level.projectId })
    await audit(req, 'validation_rule.deleted', rule)
    return { deleted: String(rule._id) }
  }

  const ORG = { scope: 'organisation', projectId: null }
  const projectLevel = (req) => ({ scope: 'project', projectId: req.project.id })
  // A project rule applies to every building of the project: an Architect
  // scoped to some buildings does not write them.
  async function assertWholeProject(req) {
    const { scopes } = await callerAccess(req)
    if (scopes.length) throw forbidden('Project rules apply to every building — an Architect covering the whole project writes them')
  }

  return {
    listOrganisation: async () => ({ rules: (await ValidationRule.find({ projectId: null }).sort({ createdAt: 1 }).lean()).map(view) }),
    createOrganisation: (req, body) => create(req, body, ORG),
    updateOrganisation: (req, id, body) => update(req, id, body, ORG),
    setOrganisationEnabled: (req, id, body) => setEnabled(req, id, body, ORG),
    removeOrganisation: (req, id) => remove(req, id, ORG),

    // What applies to a project, every member's to read.
    async listProject(req) {
      const { roles, scopes } = await callerAccess(req)
      const rows = await ValidationRule.find({ $or: [{ projectId: null }, { projectId: req.project.id }] }).sort({ createdAt: 1 }).lean()
      return {
        organisation: rows.filter((r) => !r.projectId).map(view),
        project: rows.filter((r) => r.projectId).map(view),
        canEdit: roles.some((r) => rolesAllowed(ACTIONS.MANAGE_PROJECT_VALIDATION_RULES).includes(r)) && !scopes.length,
      }
    },
    async createProject(req, body) {
      await assertWholeProject(req)
      return create(req, body, projectLevel(req))
    },
    async updateProject(req, id, body) {
      await assertWholeProject(req)
      return update(req, id, body, projectLevel(req))
    },
    async setProjectEnabled(req, id, body) {
      await assertWholeProject(req)
      return setEnabled(req, id, body, projectLevel(req))
    },
    async removeProject(req, id) {
      await assertWholeProject(req)
      return remove(req, id, projectLevel(req))
    },

    // What a draft rule would flag on one building's design now (the LLD once
    // started, else the HLD); nothing is stored. Org Admin or Architect.
    async preview(req, { buildingId, rule }) {
      const { roles } = await callerAccess(req)
      if (!roles.some((r) => ['org_admin', 'architect'].includes(r))) throw forbidden('Only an Org Admin or an Architect previews a rule')
      const building = await requireBuilding(req, buildingId)
      const started = await LldDesign.exists({ buildingId: building.id })
      const service = started ? lld : hld
      const { design, ctx } = await service.ruleDesign(req, building.id)
      const findings = customRuleFindings([{ ...rule, id: 'preview', name: rule.name, value: rule.value ?? null }], design, ctx)
      return { stage: started ? 'lld' : 'hld', count: findings.length, samples: findings.slice(0, 5).map((f) => f.message), severity: rule.severity }
    },
  }
}
