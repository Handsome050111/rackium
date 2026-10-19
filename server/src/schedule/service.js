import mongoose from 'mongoose'
import { PHASE_KEYS } from '@rackium/shared/phaseCalculations.js'
import { scheduleBars, keyOf, standardMilestones, nextMilestone, slaItemKeys, slaStatus, slaBurndown, createsCycle, isDone, SCHEDULE_DEFAULTS, STANDARD_MILESTONE_KEYS } from '@rackium/shared/schedule.js'
import { expectedSurveyTabs } from '@rackium/shared/surveyForm.js'
import { PHASE_LABELS } from '@rackium/shared/notifications.js'
import { DEFAULT_TIME_ZONE, localDate } from '@rackium/shared/timeZone.js'
import { scopeCoversBuilding } from '@rackium/shared/scope.js'
import { Building } from '../models/building.js'
import { Project } from '../models/project.js'
import { Organisation } from '../models/organisation.js'
import { ProjectSettings } from '../models/projectSettings.js'
import { PhaseTarget } from '../models/phaseTarget.js'
import { PhaseHistory } from '../models/phaseHistory.js'
import { Milestone } from '../models/milestone.js'
import { BuildingDependency } from '../models/buildingDependency.js'
import { Sla } from '../models/sla.js'
import { Blocker } from '../models/blocker.js'
import { ProcurementLine } from '../models/procurementLine.js'
import { SurveyTabRecord } from '../models/surveyTabRecord.js'
import { Room } from '../models/room.js'
import { Membership } from '../models/membership.js'
import { AuditEntry } from '../models/auditEntry.js'
import { cmoStatusByBuilding } from '../cmo/service.js'
import { surveyStatusByBuilding } from '../survey/formService.js'
import { hldStatusByBuilding } from '../hld/service.js'
import { lldStatusByBuilding } from '../lld/service.js'
import { spStatusByBuilding } from '../delivery/solutionPackage.js'
import { bomStatusByBuilding } from '../delivery/bom.js'
import { deploymentStatusesByBuilding } from '../deployment/service.js'
import { handoverStatusByBuilding } from '../handover/service.js'
import { projectScope, requireBuilding } from '../access/scope.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { notify, paths } from '../notifications/notify.js'
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js'

const id = (v) => (v ? String(v) : null)
const oid = (v) => new mongoose.Types.ObjectId(String(v))

// The audit entry that completes each phase (DATA-MODEL §5.10): its time is
// the phase's completion date. Deployment and CMDB complete with the last
// device accepted.
export const PHASE_EVIDENCE = {
  cmo: ['cmo.import.committed', 'cmo.device.assigned'],
  survey: ['survey.tab.verified'],
  hld: ['hld.approved'],
  lld: ['lld.approved'],
  'solution-package': ['solution_package.client_approved'],
  bom: ['bom.approved'],
  deployment: ['deployment.device.accepted'],
  cmdb: ['deployment.device.accepted'],
  handover: ['handover.client_approved'],
}
// Who is told when a building's phase is overdue, besides the PMs.
const PRIMARY_FOR = { cmo: 'primaryFieldEngineerId', survey: 'primaryFieldEngineerId', deployment: 'primaryFieldEngineerId', cmdb: 'primaryFieldEngineerId', hld: 'primaryArchitectId', lld: 'primaryArchitectId', 'solution-package': 'primaryArchitectId' }

export async function organisationTimeZone(organisationId = currentScope().organisationId) {
  const org = await Organisation.findById(organisationId, { 'settings.timeZone': 1 }).lean()
  return org?.settings?.timeZone ?? DEFAULT_TIME_ZONE
}

// The project's settings row (the tenant plugin fills in the scope on upsert).
async function settingsDoc() {
  return ProjectSettings.findOneAndUpdate({}, { $setOnInsert: { marginPercent: 15 } }, { upsert: true, returnDocument: 'after' })
}
const scheduleSettingsOf = (doc) => ({
  riskElapsedPct: doc?.schedule?.riskElapsedPct ?? SCHEDULE_DEFAULTS.riskElapsedPct,
  riskProgressPct: doc?.schedule?.riskProgressPct ?? SCHEDULE_DEFAULTS.riskProgressPct,
  parallelPhases: doc?.schedule?.parallelPhases ?? [],
})

// Every building's status per phase, with a progress measure where the
// phase has one (survey: verified tabs; deployment and CMDB: accepted devices).
export async function phaseMatrix() {
  const [cmo, survey, hld, lld, sp, bom, dep, handover, rooms, records] = await Promise.all([
    cmoStatusByBuilding(),
    surveyStatusByBuilding(),
    hldStatusByBuilding(),
    lldStatusByBuilding(),
    spStatusByBuilding(),
    bomStatusByBuilding(),
    deploymentStatusesByBuilding(),
    handoverStatusByBuilding(),
    Room.find({}, { buildingId: 1 }).lean(),
    SurveyTabRecord.find({}, { buildingId: 1, roomId: 1, tab: 1, status: 1 }).lean(),
  ])
  const byPhase = { cmo, survey, hld, lld, 'solution-package': sp, bom, deployment: dep.deployment, cmdb: dep.cmdb, handover }
  const statusOf = (buildingId, phaseKey) => byPhase[phaseKey]?.get(String(buildingId)) ?? 'not_started'
  const surveyMeasure = (buildingId) => {
    const roomIds = rooms.filter((r) => String(r.buildingId) === String(buildingId)).map((r) => String(r._id))
    const expected = expectedSurveyTabs(roomIds)
    if (!roomIds.length || !expected.length) return null
    const done = new Set(records.filter((r) => String(r.buildingId) === String(buildingId) && ['verified', 'imported'].includes(r.status)).map((r) => `${r.tab}|${r.roomId ? String(r.roomId) : ''}`))
    return expected.filter((e) => done.has(`${e.tab}|${e.roomId ?? ''}`)).length / expected.length
  }
  const measureOf = (buildingId, phaseKey) => {
    if (phaseKey === 'survey') return surveyMeasure(buildingId)
    if (phaseKey === 'deployment' || phaseKey === 'cmdb') return dep.progress?.get(String(buildingId)) ?? null
    return null
  }
  return { statusOf, measureOf }
}

// Records completions and reopenings (DATA-MODEL §5.10). `mode: 'live'`
// (reading the schedule, the job) records only what happened after tracking
// started; `mode: 'derived'` (the backfill script) only buildings × phases
// with no history yet, dated by their audit evidence or left unknown.
export async function syncPhaseHistory({ now = new Date(), mode = 'live', timeZone = null } = {}) {
  const tz = timeZone ?? (await organisationTimeZone())
  const settings = await settingsDoc()
  let since = settings.schedule?.historySince ?? null
  if (mode === 'live' && !since) {
    since = now
    await ProjectSettings.updateOne({ _id: settings._id }, { $set: { 'schedule.historySince': now } })
  }
  const project = await Project.findById(currentScope().projectId, { activePhases: 1 }).lean()
  const phaseKeys = (project?.activePhases ?? []).map((p) => p.phaseKey)
  const [buildings, history, matrix] = await Promise.all([Building.find({}, { _id: 1 }).lean(), PhaseHistory.find({}).sort({ recordedAt: 1, _id: 1 }).lean(), phaseMatrix()])
  const last = new Map()
  for (const h of history) last.set(keyOf(String(h.buildingId), h.phaseKey), h)
  const written = []
  for (const b of buildings) {
    for (const phaseKey of phaseKeys) {
      const key = keyOf(String(b._id), phaseKey)
      const prev = last.get(key)
      const done = isDone(matrix.statusOf(b._id, phaseKey))
      if (done && (!prev || prev.event === 'reopened')) {
        if (mode === 'derived' && prev) continue
        const after = prev?.at ?? new Date(0)
        const evidence = await AuditEntry.findOne({ buildingId: b._id, action: { $in: PHASE_EVIDENCE[phaseKey] ?? [] }, occurredAt: { $lte: now, $gt: after } }).sort({ occurredAt: -1 }).lean()
        let at = evidence?.occurredAt ?? null
        if (mode === 'live') {
          // A completion from before tracking started is the backfill's to write.
          if (!prev && (!at || at < since)) continue
          if (!at) at = now
        }
        written.push({ buildingId: b._id, phaseKey, event: 'completed', at, on: at ? localDate(at, tz) : null, dateKnown: Boolean(at), source: mode, evidence: evidence ? { auditEntryId: evidence._id, action: evidence.action } : null, recordedAt: now })
      } else if (!done && prev?.event === 'completed' && mode === 'live') {
        written.push({ buildingId: b._id, phaseKey, event: 'reopened', at: now, on: localDate(now, tz), dateKnown: true, source: 'live', evidence: null, recordedAt: now })
      }
    }
  }
  if (written.length) {
    const { organisationId, projectId } = currentScope()
    await PhaseHistory.insertMany(written.map((w) => ({ ...w, organisationId: oid(organisationId), projectId: oid(projectId) })))
  }
  return { written: written.length }
}

// Materials Ordered / Delivered per building: every procurement line ordered
// or later / delivered (the day is not recorded: shown without a date).
async function procurementByBuilding() {
  const lines = await ProcurementLine.find({}, { buildingId: 1, status: 1 }).lean()
  const out = new Map()
  for (const l of lines) {
    const k = String(l.buildingId)
    if (!out.has(k)) out.set(k, [])
    out.get(k).push(l.status)
  }
  const ordered = new Set(['ordered', 'shipped', 'delivered'])
  return (buildingId) => {
    const list = out.get(String(buildingId)) ?? []
    return { ordered: { done: list.length > 0 && list.every((s) => ordered.has(s)), on: null }, delivered: { done: list.length > 0 && list.every((s) => s === 'delivered'), on: null } }
  }
}

// Everything the schedule shows, for the given buildings (the caller's).
async function computeSchedule({ buildings, now = new Date(), timeZone, scopeLimited = false }) {
  const today = localDate(now, timeZone)
  const project = await Project.findById(currentScope().projectId, { activePhases: 1 }).lean()
  const phaseKeys = (project?.activePhases ?? []).slice().sort((a, b) => a.position - b.position).map((p) => p.phaseKey).filter((p) => PHASE_KEYS.includes(p))
  const settings = scheduleSettingsOf(await ProjectSettings.findOne({}).lean())
  const buildingIds = buildings.map((b) => String(b.id))
  const inScope = new Set(buildingIds)
  const [matrix, targets, history, blockers, allDependencies, milestoneRows, slaRows, procurement] = await Promise.all([
    phaseMatrix(),
    PhaseTarget.find({}).lean(),
    PhaseHistory.find({}).sort({ recordedAt: 1, _id: 1 }).lean(),
    Blocker.find({ status: { $ne: 'resolved' }, buildingId: { $ne: null } }, { buildingId: 1, phaseKey: 1 }).lean(),
    BuildingDependency.find({}).lean(),
    Milestone.find({}).lean(),
    Sla.find({}).sort({ dueDate: 1, createdAt: 1 }).lean(),
    procurementByBuilding(),
  ])
  const targetOf = new Map(targets.map((t) => [keyOf(String(t.buildingId), t.phaseKey), t]))
  const eventsOf = new Map()
  for (const h of history) {
    const k = keyOf(String(h.buildingId), h.phaseKey)
    if (!eventsOf.has(k)) eventsOf.set(k, [])
    eventsOf.get(k).push({ event: h.event, on: h.on, dateKnown: h.dateKnown })
  }
  // Done with no history (completed before tracking, not backfilled): done
  // from the start, date unknown.
  const eventsFor = (k, status) => {
    const events = eventsOf.get(k) ?? []
    return isDone(status) && !events.some((e) => e.event === 'completed') ? [...events, { event: 'completed', on: null, dateKnown: false }] : events
  }
  const blocked = new Set(blockers.map((b) => keyOf(String(b.buildingId), b.phaseKey)))
  // A dependency is shown only when the caller can see both buildings.
  const dependencies = allDependencies.filter((d) => inScope.has(String(d.from.buildingId)) && inScope.has(String(d.to.buildingId)))
  const rows = {}
  for (const b of buildingIds) {
    for (const p of phaseKeys) {
      const k = keyOf(b, p)
      const t = targetOf.get(k)
      const status = matrix.statusOf(b, p)
      const events = eventsOf.get(k) ?? []
      const lastCompleted = [...events].reverse().find((e) => e.event === 'completed')
      rows[k] = { status, measure: matrix.measureOf(b, p), startDate: t?.startDate ?? null, targetDate: t?.targetDate ?? null, completedOn: isDone(status) ? lastCompleted?.on ?? null : null, blocked: blocked.has(k) }
    }
  }
  const plan = scheduleBars({ buildingIds, phaseKeys, parallelPhases: settings.parallelPhases, dependencies: dependencies.map((d) => ({ from: { buildingId: String(d.from.buildingId), phaseKey: d.from.phaseKey }, to: { buildingId: String(d.to.buildingId), phaseKey: d.to.phaseKey } })), rows, today, settings })
  for (const bar of plan.bars) bar.dateKnown = !isDone(bar.status) || (eventsOf.get(bar.key) ?? []).some((e) => e.event === 'completed' && e.dateKnown)

  const barsByBuilding = new Map()
  for (const bar of plan.bars) {
    if (!barsByBuilding.has(bar.buildingId)) barsByBuilding.set(bar.buildingId, {})
    barsByBuilding.get(bar.buildingId)[bar.phaseKey] = bar
  }
  const overrides = new Map()
  for (const m of milestoneRows.filter((m) => m.standardKey)) overrides.set(`${m.buildingId}|${m.standardKey}`, m.dueDate)
  const milestones = []
  for (const b of buildingIds) {
    const o = Object.fromEntries(STANDARD_MILESTONE_KEYS.filter((k) => overrides.has(`${b}|${k}`)).map((k) => [k, overrides.get(`${b}|${k}`)]))
    milestones.push(...standardMilestones({ buildingId: b, phaseKeys, barsByPhase: barsByBuilding.get(b) ?? {}, procurement: procurement(b), overrides: o }))
  }
  for (const m of milestoneRows.filter((m) => !m.standardKey && (!m.buildingId || inScope.has(String(m.buildingId))))) {
    milestones.push({ id: String(m._id), standardKey: null, buildingId: id(m.buildingId), name: m.name, dueDate: m.dueDate, done: Boolean(m.completedOn), doneOn: m.completedOn ?? null, custom: true })
  }

  const slas = slaRows
    .filter((s) => !s.buildingId || inScope.has(String(s.buildingId)))
    .map((s) => {
      const keys = slaItemKeys({ sla: { buildingId: id(s.buildingId), phaseKey: s.phaseKey }, buildingIds, phaseKeys })
      const items = keys.map((k) => ({ key: k, done: isDone(rows[k]?.status), events: eventsFor(k, rows[k]?.status) }))
      return { sla: s, items, ...slaStatus({ sla: s, items, today }) }
    })
  return { today, phaseKeys, settings, plan, milestones, dependencies, slas, scopeLimited }
}

const slaView = ({ sla, status, total, remaining, done, projectedOn }, scopeLimited) => ({
  id: String(sla._id),
  name: sla.name,
  buildingId: id(sla.buildingId),
  phaseKey: sla.phaseKey ?? null,
  startDate: sla.startDate,
  dueDate: sla.dueDate,
  status,
  total,
  remaining,
  done,
  projectedOn,
  scopeLimited: scopeLimited && !sla.buildingId,
})

export function createScheduleService() {
  // Writes: the Org Admin or PM (the route checks the role); a project-wide
  // item needs an unscoped caller.
  async function requireUnscoped(req) {
    const scope = await projectScope(req)
    if (!scope.unrestricted) throw forbidden('Only the Org Admin or an unscoped PM changes project-wide schedule items')
  }
  async function activePhaseKeys(req) {
    return (req.project.doc?.activePhases ?? []).map((p) => p.phaseKey)
  }
  async function audit(req, actor, action, { buildingId = null, objectType, objectId = null, comment = null, changes = [], phaseKey = null }) {
    await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId, phaseKey, actor: userActor(actor.userId, actor.role), action, objectType, objectId, changeType: 'design_intent', source: 'ui', comment, changes })
  }

  return {
    async view(req, { now = new Date() } = {}) {
      const tz = await organisationTimeZone(req.org.id)
      await syncPhaseHistory({ now, timeZone: tz })
      const scope = await projectScope(req)
      const all = await Building.find({}, { code: 1, name: 1, primaryArchitectId: 1, primaryFieldEngineerId: 1 }).sort({ code: 1 }).lean()
      const buildings = all.filter((b) => scope.coversBuilding(String(b._id))).map((b) => ({ id: String(b._id), code: b.code, name: b.name, primaryArchitectId: id(b.primaryArchitectId), primaryFieldEngineerId: id(b.primaryFieldEngineerId) }))
      const s = await computeSchedule({ buildings, now, timeZone: tz, scopeLimited: !scope.unrestricted })
      return {
        today: s.today,
        timeZone: tz,
        phases: s.phaseKeys,
        settings: s.settings,
        scopeLimited: s.scopeLimited,
        buildings,
        bars: s.plan.bars,
        critical: s.plan.critical,
        end: s.plan.end,
        milestones: s.milestones,
        next: nextMilestone(s.milestones),
        dependencies: s.dependencies.map((d) => ({ id: String(d._id), from: { buildingId: String(d.from.buildingId), phaseKey: d.from.phaseKey }, to: { buildingId: String(d.to.buildingId), phaseKey: d.to.phaseKey } })),
        slas: s.slas.map((x) => slaView(x, s.scopeLimited)),
      }
    },

    // Targets and starts for any buildings × phases (one audit entry per building).
    async setTargets(req, { targets }, actor) {
      const phases = await activePhaseKeys(req)
      const byBuilding = new Map()
      for (const t of targets) {
        if (!phases.includes(t.phaseKey)) throw badRequest(`${PHASE_LABELS[t.phaseKey] ?? t.phaseKey} is not an active phase of this project`)
        await requireBuilding(req, t.buildingId)
        if (!byBuilding.has(t.buildingId)) byBuilding.set(t.buildingId, [])
        byBuilding.get(t.buildingId).push(t)
      }
      for (const [buildingId, list] of byBuilding) {
        const changes = []
        for (const t of list) {
          const existing = await PhaseTarget.findOne({ buildingId: oid(buildingId), phaseKey: t.phaseKey }).lean()
          const next = { startDate: t.startDate === undefined ? existing?.startDate ?? null : t.startDate, targetDate: t.targetDate === undefined ? existing?.targetDate ?? null : t.targetDate }
          if (next.startDate && next.targetDate && next.startDate > next.targetDate) throw badRequest(`${PHASE_LABELS[t.phaseKey]}: the start is after the target date`)
          for (const f of ['startDate', 'targetDate']) {
            if ((existing?.[f] ?? null) !== next[f]) changes.push({ objectType: 'PhaseTarget', objectId: `${buildingId}:${t.phaseKey}`, field: `${t.phaseKey}.${f}`, before: existing?.[f] ?? null, after: next[f] })
          }
          await PhaseTarget.updateOne({ buildingId: oid(buildingId), phaseKey: t.phaseKey }, { $set: { ...next, setBy: actor.userId, setAt: new Date() } }, { upsert: true })
        }
        if (changes.length) await audit(req, actor, 'schedule.targets.updated', { buildingId, objectType: 'Building', objectId: buildingId, comment: `${changes.length} date(s) changed`, changes })
      }
      return { updated: targets.length }
    },

    async updateSettings(req, body, actor) {
      await requireUnscoped(req)
      const phases = await activePhaseKeys(req)
      if (body.parallelPhases && body.parallelPhases.some((p) => !phases.includes(p))) throw badRequest('Only active phases can run in parallel')
      const doc = await settingsDoc()
      const before = scheduleSettingsOf(doc)
      const set = {}
      for (const f of ['riskElapsedPct', 'riskProgressPct', 'parallelPhases']) if (body[f] !== undefined) set[`schedule.${f}`] = body[f]
      await ProjectSettings.updateOne({ _id: doc._id }, { $set: set })
      const after = scheduleSettingsOf(await ProjectSettings.findById(doc._id).lean())
      const changes = Object.keys(after).filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])).map((f) => ({ objectType: 'ProjectSettings', objectId: String(doc._id), field: `schedule.${f}`, before: before[f], after: after[f] }))
      if (changes.length) await audit(req, actor, 'schedule.settings.updated', { objectType: 'ProjectSettings', objectId: String(doc._id), changes })
      return { settings: after }
    },

    async addMilestone(req, body, actor) {
      if (body.buildingId) await requireBuilding(req, body.buildingId)
      else await requireUnscoped(req)
      const [m] = await Milestone.create([{ buildingId: body.buildingId ? oid(body.buildingId) : null, name: body.name, dueDate: body.dueDate ?? null, createdBy: actor.userId }])
      await audit(req, actor, 'schedule.milestone.created', { buildingId: body.buildingId ?? null, objectType: 'Milestone', objectId: String(m._id), comment: `${m.name}${m.dueDate ? ` due ${m.dueDate}` : ''}` })
      return { milestone: { id: String(m._id), name: m.name, buildingId: id(m.buildingId), dueDate: m.dueDate, done: false, doneOn: null, custom: true } }
    },

    async updateMilestone(req, milestoneId, body, actor) {
      const m = await customMilestone(req, milestoneId)
      const changes = []
      for (const f of ['name', 'dueDate', 'completedOn']) {
        if (body[f] !== undefined && (m[f] ?? null) !== body[f]) {
          changes.push({ objectType: 'Milestone', objectId: String(m._id), field: f, before: m[f] ?? null, after: body[f] })
          m[f] = body[f]
        }
      }
      await m.save()
      if (changes.length) await audit(req, actor, 'schedule.milestone.updated', { buildingId: id(m.buildingId), objectType: 'Milestone', objectId: String(m._id), changes })
      return { milestone: { id: String(m._id), name: m.name, buildingId: id(m.buildingId), dueDate: m.dueDate, done: Boolean(m.completedOn), doneOn: m.completedOn, custom: true } }
    },

    async removeMilestone(req, milestoneId, actor) {
      const m = await customMilestone(req, milestoneId)
      await Milestone.deleteOne({ _id: m._id })
      await audit(req, actor, 'schedule.milestone.deleted', { buildingId: id(m.buildingId), objectType: 'Milestone', objectId: String(m._id), comment: m.name })
      return { deleted: String(m._id) }
    },

    // A standard milestone's due date moved by the PM (null = back to the phase target).
    async setStandardDue(req, { buildingId, standardKey, dueDate }, actor) {
      await requireBuilding(req, buildingId)
      const existing = await Milestone.findOne({ buildingId: oid(buildingId), standardKey }).lean()
      if (dueDate === null) await Milestone.deleteOne({ buildingId: oid(buildingId), standardKey })
      else await Milestone.updateOne({ buildingId: oid(buildingId), standardKey }, { $set: { dueDate }, $setOnInsert: { createdBy: actor.userId } }, { upsert: true })
      await audit(req, actor, 'schedule.milestone.updated', { buildingId, objectType: 'Milestone', objectId: `${buildingId}:${standardKey}`, changes: [{ objectType: 'Milestone', objectId: `${buildingId}:${standardKey}`, field: 'dueDate', before: existing?.dueDate ?? null, after: dueDate }] })
      return { standardKey, buildingId, dueDate }
    },

    async addDependency(req, body, actor) {
      const phases = await activePhaseKeys(req)
      if (!phases.includes(body.from.phaseKey) || !phases.includes(body.to.phaseKey)) throw badRequest('Both phases must be active phases of this project')
      if (body.from.buildingId === body.to.buildingId) throw badRequest('A dependency links two different buildings — inside a building the phases follow their order')
      const [from, to] = [await requireBuilding(req, body.from.buildingId), await requireBuilding(req, body.to.buildingId)]
      const all = await BuildingDependency.find({}).lean()
      const existing = all.map((d) => ({ from: { buildingId: String(d.from.buildingId), phaseKey: d.from.phaseKey }, to: { buildingId: String(d.to.buildingId), phaseKey: d.to.phaseKey } }))
      if (existing.some((d) => d.from.buildingId === from.id && d.from.phaseKey === body.from.phaseKey && d.to.buildingId === to.id && d.to.phaseKey === body.to.phaseKey)) throw conflict('dependency_exists', 'This dependency already exists')
      const buildingIds = (await Building.find({}, { _id: 1 }).lean()).map((b) => String(b._id))
      const settings = scheduleSettingsOf(await ProjectSettings.findOne({}).lean())
      if (createsCycle({ buildingIds, phaseKeys: phases, parallelPhases: settings.parallelPhases, dependencies: existing, candidate: { from: { buildingId: from.id, phaseKey: body.from.phaseKey }, to: { buildingId: to.id, phaseKey: body.to.phaseKey } } })) {
        throw conflict('dependency_cycle', 'This dependency would make a loop: the phases could never start')
      }
      const [d] = await BuildingDependency.create([{ from: { buildingId: oid(from.id), phaseKey: body.from.phaseKey }, to: { buildingId: oid(to.id), phaseKey: body.to.phaseKey }, createdBy: actor.userId }])
      const text = `${from.code} ${PHASE_LABELS[body.from.phaseKey]} before ${to.code} ${PHASE_LABELS[body.to.phaseKey]}`
      await audit(req, actor, 'schedule.dependency.created', { buildingId: to.id, objectType: 'BuildingDependency', objectId: String(d._id), comment: text })
      return { dependency: { id: String(d._id), from: { buildingId: from.id, phaseKey: body.from.phaseKey }, to: { buildingId: to.id, phaseKey: body.to.phaseKey } } }
    },

    async removeDependency(req, dependencyId, actor) {
      const d = mongoose.isValidObjectId(dependencyId) ? await BuildingDependency.findById(dependencyId).lean() : null
      if (!d) throw notFound('Dependency not found')
      // Both ends must be in the caller's scope (otherwise it is not listed to them).
      await requireBuilding(req, d.from.buildingId).catch(() => {
        throw notFound('Dependency not found')
      })
      await requireBuilding(req, d.to.buildingId).catch(() => {
        throw notFound('Dependency not found')
      })
      await BuildingDependency.deleteOne({ _id: d._id })
      await audit(req, actor, 'schedule.dependency.deleted', { buildingId: id(d.to.buildingId), objectType: 'BuildingDependency', objectId: String(d._id) })
      return { deleted: String(d._id) }
    },

    async createSla(req, body, actor) {
      if (body.buildingId) await requireBuilding(req, body.buildingId)
      else await requireUnscoped(req)
      if (body.phaseKey && !(await activePhaseKeys(req)).includes(body.phaseKey)) throw badRequest('Not an active phase of this project')
      const tz = await organisationTimeZone(req.org.id)
      const startDate = body.startDate ?? localDate(new Date(), tz)
      if (body.dueDate < startDate) throw badRequest('The due date is before the start')
      const [s] = await Sla.create([{ buildingId: body.buildingId ? oid(body.buildingId) : null, phaseKey: body.phaseKey ?? null, name: body.name, startDate, dueDate: body.dueDate, createdBy: actor.userId }])
      await audit(req, actor, 'schedule.sla.created', { buildingId: body.buildingId ?? null, objectType: 'Sla', objectId: String(s._id), comment: `${s.name} due ${s.dueDate}` })
      return { sla: { id: String(s._id), name: s.name, buildingId: id(s.buildingId), phaseKey: s.phaseKey, startDate, dueDate: s.dueDate } }
    },

    async updateSla(req, slaId, body, actor) {
      const s = await writableSla(req, slaId)
      const changes = []
      for (const f of ['name', 'dueDate', 'startDate']) {
        if (body[f] !== undefined && s[f] !== body[f]) {
          changes.push({ objectType: 'Sla', objectId: String(s._id), field: f, before: s[f], after: body[f] })
          s[f] = body[f]
        }
      }
      if (s.dueDate < s.startDate) throw badRequest('The due date is before the start')
      // A new due date re-arms the alerts.
      if (changes.some((c) => c.field === 'dueDate')) Object.assign(s, { atRiskNotifiedAt: null, breachedNotifiedAt: null })
      await s.save()
      if (changes.length) await audit(req, actor, 'schedule.sla.updated', { buildingId: id(s.buildingId), objectType: 'Sla', objectId: String(s._id), changes })
      return { sla: { id: String(s._id), name: s.name, buildingId: id(s.buildingId), phaseKey: s.phaseKey, startDate: s.startDate, dueDate: s.dueDate } }
    },

    async removeSla(req, slaId, actor) {
      const s = await writableSla(req, slaId)
      await Sla.deleteOne({ _id: s._id })
      await audit(req, actor, 'schedule.sla.deleted', { buildingId: id(s.buildingId), objectType: 'Sla', objectId: String(s._id), comment: s.name })
      return { deleted: String(s._id) }
    },

    // The burn-down over the caller's buildings in the SLA's scope.
    async burndown(req, slaId, { now = new Date() } = {}) {
      const s = mongoose.isValidObjectId(slaId) ? await Sla.findById(slaId).lean() : null
      if (!s) throw notFound('SLA not found')
      if (s.buildingId) await requireBuilding(req, s.buildingId).catch(() => {
        throw notFound('SLA not found')
      })
      const tz = await organisationTimeZone(req.org.id)
      const scope = await projectScope(req)
      const buildings = (await Building.find({}, { code: 1 }).lean()).filter((b) => scope.coversBuilding(String(b._id))).map((b) => ({ id: String(b._id) }))
      const sched = await computeSchedule({ buildings, now, timeZone: tz })
      const entry = sched.slas.find((x) => String(x.sla._id) === String(s._id))
      return { sla: slaView(entry, !scope.unrestricted), series: slaBurndown({ sla: s, items: entry.items, today: sched.today }) }
    },

    // The building's primary Architect and Field Engineer (v2.2 §21.5).
    async setAssignees(req, buildingId, body, actor) {
      const building = await requireBuilding(req, buildingId)
      const doc = await Building.findById(buildingId)
      const changes = []
      for (const [field, role] of [['primaryArchitectId', 'architect'], ['primaryFieldEngineerId', 'field_engineer']]) {
        if (body[field] === undefined) continue
        if (body[field]) {
          const m = await Membership.findOne({ level: 'project', projectId: oid(req.project.id), userId: oid(body[field]), role, active: true }).lean()
          if (!m || !scopeCoversBuilding(m.scopes ?? [], building)) throw badRequest(`Choose a ${role === 'architect' ? 'Network Architect' : 'Field Engineer'} of this project whose scope covers ${building.code}`)
        }
        if (id(doc[field]) !== (body[field] ?? null)) {
          changes.push({ objectType: 'Building', objectId: building.id, field, before: id(doc[field]), after: body[field] ?? null })
          doc[field] = body[field] ? oid(body[field]) : null
        }
      }
      await doc.save()
      if (changes.length) await audit(req, actor, 'building.assignees.updated', { buildingId: building.id, objectType: 'Building', objectId: building.id, changes })
      return { building: { id: building.id, primaryArchitectId: id(doc.primaryArchitectId), primaryFieldEngineerId: id(doc.primaryFieldEngineerId) } }
    },
  }

  async function customMilestone(req, milestoneId) {
    const m = mongoose.isValidObjectId(milestoneId) ? await Milestone.findById(milestoneId) : null
    if (!m || m.standardKey) throw notFound('Milestone not found')
    if (m.buildingId) {
      await requireBuilding(req, m.buildingId).catch(() => {
        throw notFound('Milestone not found')
      })
    } else await requireUnscoped(req)
    return m
  }
  async function writableSla(req, slaId) {
    const s = mongoose.isValidObjectId(slaId) ? await Sla.findById(slaId) : null
    if (!s) throw notFound('SLA not found')
    if (s.buildingId) {
      await requireBuilding(req, s.buildingId).catch(() => {
        throw notFound('SLA not found')
      })
    } else await requireUnscoped(req)
    return s
  }
}

// The dashboard's "Next milestone" for one building: its standard and custom
// milestones and the project-wide ones (M7a-1, brief v2.3 §7.3).
export async function nextMilestoneForBuilding(buildingId, { now = new Date() } = {}) {
  const tz = await organisationTimeZone()
  const s = await computeSchedule({ buildings: [{ id: String(buildingId) }], now, timeZone: tz })
  return nextMilestone(s.milestones)
}

// The alerts (job, every 15 minutes; v2.2 §21.8): phase overdue → PMs and the
// building's primary person; SLA at risk → PMs; SLA breached → PMs and the
// Org Admins. Each once, through a claim.
export async function scheduleAlerts({ now = new Date(), forEachProject }) {
  const out = { phaseOverdue: 0, slaAtRisk: 0, slaBreached: 0 }
  await forEachProject(async ({ organisationId, projectId, timeZone }) => {
    await syncPhaseHistory({ now, timeZone })
    const buildingDocs = await Building.find({}, { code: 1, primaryArchitectId: 1, primaryFieldEngineerId: 1 }).lean()
    if (!buildingDocs.length) return
    const s = await computeSchedule({ buildings: buildingDocs.map((b) => ({ id: String(b._id) })), now, timeZone })
    const link = paths.schedule(organisationId, projectId)
    const byId = new Map(buildingDocs.map((b) => [String(b._id), b]))
    for (const bar of s.plan.bars.filter((b) => b.risk === 'overdue')) {
      const claimed = await PhaseTarget.findOneAndUpdate({ buildingId: oid(bar.buildingId), phaseKey: bar.phaseKey, targetDate: bar.target, overdueNotifiedFor: { $ne: bar.target } }, { $set: { overdueNotifiedFor: bar.target } })
      if (!claimed) continue
      const b = byId.get(bar.buildingId)
      const primary = PRIMARY_FOR[bar.phaseKey] ? b?.[PRIMARY_FOR[bar.phaseKey]] : null
      await notify({ type: 'phase_overdue', projectId, buildingId: bar.buildingId, title: `${b?.code ?? ''} ${PHASE_LABELS[bar.phaseKey]} is overdue`.trim(), body: `Its target date was ${bar.target}.`, link, to: { roles: ['pm'], userIds: primary ? [primary] : [] } })
      out.phaseOverdue += 1
    }
    for (const x of s.slas) {
      const where = x.sla.buildingId ? byId.get(String(x.sla.buildingId))?.code : null
      if (x.status === 'breached' && !x.sla.breachedNotifiedAt) {
        const claimed = await Sla.findOneAndUpdate({ _id: x.sla._id, breachedNotifiedAt: null }, { $set: { breachedNotifiedAt: now } })
        if (!claimed) continue
        await notify({ type: 'sla_breached', projectId, buildingId: x.sla.buildingId, title: `SLA breached: ${x.sla.name}`, body: `It was due on ${x.sla.dueDate}${where ? ` (${where})` : ''}; ${x.remaining} of ${x.total} item(s) are still open.`, link, to: { roles: ['pm'], orgAdmins: true } })
        out.slaBreached += 1
      } else if (x.status === 'at_risk' && !x.sla.atRiskNotifiedAt) {
        const claimed = await Sla.findOneAndUpdate({ _id: x.sla._id, atRiskNotifiedAt: null }, { $set: { atRiskNotifiedAt: now } })
        if (!claimed) continue
        await notify({ type: 'sla_at_risk', projectId, buildingId: x.sla.buildingId, title: `SLA at risk: ${x.sla.name}`, body: x.projectedOn ? `At the current pace it finishes on ${x.projectedOn}, after its due date ${x.sla.dueDate}.` : `Half its time has passed with nothing done; it is due on ${x.sla.dueDate}.`, link, to: { roles: ['pm'] } })
        out.slaAtRisk += 1
      } else if (x.status === 'on_track' && x.sla.atRiskNotifiedAt) {
        // Back on track: a later risk is told again.
        await Sla.updateOne({ _id: x.sla._id }, { $set: { atRiskNotifiedAt: null } })
      }
    }
  })
  return out
}


// The backfill (server/scripts/backfill-phase-history.mjs, run by hand): every
// project's completed phases with no history yet, dated by their audit
// evidence or left unknown; `source: derived`. Running it twice writes nothing more.
export async function backfillPhaseHistory({ now = new Date(), forEachProject }) {
  const out = { projects: 0, written: 0 }
  await forEachProject(async ({ timeZone }) => {
    const { written } = await syncPhaseHistory({ now, mode: 'derived', timeZone })
    out.projects += 1
    out.written += written
  })
  return out
}
