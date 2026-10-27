import { RESOURCE_TASKS } from '@rackium/shared/billOfResources.js'
import { ProjectSettings } from '../models/projectSettings.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { badRequest } from '../http/errors.js'
import { canSeePrices } from '@rackium/shared/policy.js'
import { callerAccess } from '../access/scope.js'
import { projectSettings, organisationCommercial } from './common.js'

// The PM's commercial and resource standards for a project (DATA-MODEL §3.9
// subset, M5a): margin %, Bill of Resources minutes per task, and the
// customer power-cord standard that overrides every cord (brief §6.7).
export function createCommercialSettingsService() {
  return {
    // The margin is for those who may see prices (D20): everyone else —
    // Architects without the setting, Field Engineers, Viewers, External
    // Reviewers — gets the settings without it.
    async get(req) {
      const settings = await projectSettings()
      const { roles } = await callerAccess(req)
      const { architectsSeePrices } = await organisationCommercial()
      if (!canSeePrices(roles, { architectsSeePrices })) delete settings.marginPercent
      return { settings: { ...settings, tasks: RESOURCE_TASKS } }
    },

    async update(req, body, actor) {
      const before = await projectSettings()
      const set = { updatedBy: actor.userId, updatedAt: new Date() }
      if (body.marginPercent !== undefined) set.marginPercent = body.marginPercent
      if (body.powerCordStandard !== undefined) set.powerCordStandard = body.powerCordStandard
      if (body.resourceMinutes !== undefined) {
        const unknown = Object.keys(body.resourceMinutes).filter((k) => !RESOURCE_TASKS.some((t) => t.id === k))
        if (unknown.length) throw badRequest(`Unknown task(s): ${unknown.join(', ')}`)
        for (const [task, minutes] of Object.entries(body.resourceMinutes)) set[`resourceMinutes.${task}`] = minutes
      }
      await ProjectSettings.updateOne({}, { $set: set }, { upsert: true })
      const after = await projectSettings()
      const changes = []
      if (body.marginPercent !== undefined) changes.push({ objectType: 'ProjectSettings', objectId: String(req.project.id), field: 'marginPercent', before: before.marginPercent, after: after.marginPercent })
      if (body.powerCordStandard !== undefined) changes.push({ objectType: 'ProjectSettings', objectId: String(req.project.id), field: 'powerCordStandard', before: before.powerCordStandard?.label ?? null, after: after.powerCordStandard?.label ?? null })
      for (const task of Object.keys(body.resourceMinutes ?? {})) changes.push({ objectType: 'ProjectSettings', objectId: String(req.project.id), field: `resourceMinutes.${task}`, before: before.resourceMinutes[task], after: after.resourceMinutes[task] })
      await recordAudit({ organisationId: req.org.id, projectId: req.project.id, actor: userActor(actor.userId, actor.role), action: 'settings.updated', objectType: 'Project', objectId: String(req.project.id), changeType: 'design_intent', source: 'ui', changes })
      return { settings: { ...after, tasks: RESOURCE_TASKS } }
    },
  }
}
