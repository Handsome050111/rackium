import mongoose from 'mongoose'
import { resolveModeLabels, isCmoDevice, modeOf, MODE_STATES, DEFAULT_MODE_LABELS } from '@rackium/shared/modeState.js'
import { deviceDisplayName } from '@rackium/shared/deviceName.js'
import { CmoDecision } from '../models/cmoDecision.js'
import { Device } from '../models/device.js'
import { DesignBranch } from '../models/designBranch.js'
import { Organisation } from '../models/organisation.js'
import { ProjectSettings } from '../models/projectSettings.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor } from '../audit/audit.js'

// Mode states and the decisions on existing (CMO) gear (M7b-4a, DATA-MODEL
// §5.21). Shared by the HLD (where decisions are made) and the LLD (which
// reads them and, on approval, writes Keep onto the devices).

const oid = (v) => new mongoose.Types.ObjectId(String(v))
const id = (v) => (v ? String(v) : null)

// The labels in force for the project: defaults, organisation, project.
export async function modeLabelsOf(session = null) {
  const org = await Organisation.findById(currentScope().organisationId, { 'settings.modeLabels': 1 }).session(session).lean()
  const project = await ProjectSettings.findOne({}, { modeLabels: 1 }).session(session).lean()
  return resolveModeLabels(org?.settings?.modeLabels, project?.modeLabels)
}

export async function decisionsOf(buildingId, layer, session = null) {
  return CmoDecision.find({ buildingId, layer }).session(session).lean()
}

// The HLD layer an LLD layer reads its decisions from: a change request's
// branch that includes the HLD has its own; everything else reads the main HLD.
export async function hldLayerForLld(layer, session = null) {
  const branchId = layer?.startsWith('lld:') ? layer.slice(4) : null
  if (!branchId || !mongoose.isValidObjectId(branchId)) return 'hld'
  return (await DesignBranch.exists({ _id: branchId, includesHld: true }).session(session)) ? `hld:${branchId}` : 'hld'
}

// A decision as the screens and rules read it; `nameOf(id)` names the replacement.
export function decisionView(decision, nameOf = () => null) {
  if (!decision) return null
  return {
    decision: decision.decision,
    role: decision.role ?? null,
    hostname: decision.hostname ?? null,
    replacedById: id(decision.replacedById),
    replacedByName: decision.replacedById ? nameOf(String(decision.replacedById)) : null,
    decidedAt: decision.decidedAt ?? null,
  }
}

// Branch copies: a change request's HLD layer gets the main decisions, the
// replacement mapped onto the branch's copy of that device.
export async function copyDecisions({ buildingId, from, to, mapId = (x) => x, session }) {
  const rows = await CmoDecision.find({ buildingId, layer: from }).session(session).lean()
  await CmoDecision.deleteMany({ buildingId, layer: to }, { session })
  for (const r of rows) {
    const { _id, __v, layer: _layer, ...fields } = r
    await CmoDecision.create([{ ...fields, layer: to, replacedById: r.replacedById ? oid(mapId(String(r.replacedById))) : null }], { session })
  }
}

export async function dropDecisions({ buildingId, layer, session }) {
  await CmoDecision.deleteMany({ buildingId, layer }, { session })
}

// The main HLD's decisions written onto the building's CMO devices (an
// approved LLD, or an approved change request): Keep → the future state, the
// role and the new name, the old name kept once in legacyHostname (immutable,
// §5.19); a device no longer kept goes back to the current state. Returns the
// renames ({ deviceId, from, to }) and the audit changes.
export async function applyCmoDecisions({ buildingId, session }) {
  const decisions = new Map((await decisionsOf(buildingId, 'hld', session)).map((d) => [String(d.deviceId), d]))
  const devices = (await Device.find({ buildingId, origin: 'existing' }).session(session).lean()).filter(isCmoDevice)
  const renamed = []
  const changes = []
  const change = (d, field, before, after) => changes.push({ objectType: 'Device', objectId: String(d._id), field, before: before ?? null, after: after ?? null })
  for (const d of devices) {
    const decision = decisions.get(String(d._id))
    const kept = decision?.decision === 'keep'
    const set = {}
    if (kept) {
      if (modeOf(d) !== 'future') set.modeState = 'future'
      if (decision.role && decision.role !== d.role) set.role = decision.role
      if (decision.hostname && decision.hostname !== d.hostname) {
        set.hostname = decision.hostname
        // The new name is the one on site from now on; the old one is kept below.
        if (d.existingLabel) set.existingLabel = null
      }
    } else if (modeOf(d) === 'future') {
      set.modeState = 'current'
    }
    if (!Object.keys(set).length) continue
    await Device.updateOne({ _id: d._id }, { $set: set }, { session })
    for (const [field, after] of Object.entries(set)) change(d, field, field === 'modeState' ? modeOf(d) : d[field], after)
    if (set.hostname) {
      const from = deviceDisplayName(d, 'Device')
      renamed.push({ deviceId: String(d._id), from, to: set.hostname })
      if (!d.legacyHostname) {
        await Device.updateOne({ _id: d._id, legacyHostname: null }, { $set: { legacyHostname: from } }, { session })
        change(d, 'legacyHostname', null, from)
      }
    }
  }
  return { renamed, changes }
}

// The project's labels screen (Project settings): the labels in force, the
// organisation's, and the project's own overrides (null = inherited).
export async function projectModeLabels() {
  const org = await Organisation.findById(currentScope().organisationId, { 'settings.modeLabels': 1 }).lean()
  const project = await ProjectSettings.findOne({}, { modeLabels: 1 }).lean()
  const own = Object.fromEntries(MODE_STATES.map((s) => [s, project?.modeLabels?.[s] ?? null]))
  return { modeLabels: resolveModeLabels(org?.settings?.modeLabels, own), organisation: resolveModeLabels(org?.settings?.modeLabels), project: own, defaults: DEFAULT_MODE_LABELS }
}

// Sets or clears (null) the project's overrides; audited.
export async function updateProjectModeLabels(req, { modeLabels }, actor) {
  const before = await projectModeLabels()
  const set = { updatedBy: actor.userId, updatedAt: new Date() }
  for (const state of MODE_STATES) if (modeLabels[state] !== undefined) set[`modeLabels.${state}`] = modeLabels[state] && modeLabels[state] !== before.organisation[state] ? modeLabels[state] : null
  await ProjectSettings.updateOne({}, { $set: set }, { upsert: true })
  const after = await projectModeLabels()
  const changes = MODE_STATES.filter((s) => before.modeLabels[s] !== after.modeLabels[s]).map((s) => ({ objectType: 'Project', objectId: String(req.project.id), field: `modeLabels.${s}`, before: before.modeLabels[s], after: after.modeLabels[s] }))
  if (changes.length) await recordAudit({ organisationId: req.org.id, projectId: req.project.id, actor: userActor(actor.userId, actor.role), action: 'settings.mode_labels.updated', objectType: 'Project', objectId: String(req.project.id), changeType: 'design_intent', source: 'ui', changes })
  return after
}
