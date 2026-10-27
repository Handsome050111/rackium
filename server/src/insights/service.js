import mongoose from 'mongoose'
import { PHASE_KEYS } from '@rackium/shared/phaseCalculations.js'
import { summarise } from '@rackium/shared/dguvRollup.js'
import { phaseDurations, blockerFrequency, blockerResolution, bomAccuracy, bomRevisions, surveyCompletion, approvalTurnaround } from '@rackium/shared/reports.js'
import { expectedSurveyTabs } from '@rackium/shared/surveyForm.js'
import { Project } from '../models/project.js'
import { PhaseHistory } from '../models/phaseHistory.js'
import { PhaseTarget } from '../models/phaseTarget.js'
import { Blocker } from '../models/blocker.js'
import { Approval } from '../models/approval.js'
import { DesignVersion } from '../models/designVersion.js'
import { SurveyTabRecord } from '../models/surveyTabRecord.js'
import { Room } from '../models/room.js'
import { DeploymentRecord } from '../models/deploymentRecord.js'
import { ConnectionRecord } from '../models/connectionRecord.js'
import { Connection } from '../models/connection.js'
import { deploymentStatusesByBuilding } from '../deployment/service.js'
import { User } from '../models/user.js'
import { membershipsForUser } from '../auth/service.js'
import { rolesIn } from '../organisations/service.js'
import { readSnapshot } from '../delivery/common.js'
import { projectScope } from '../access/scope.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { projectFacts, projectPeople, utilisationOf, bomValueOf, localDay } from './facts.js'

const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null)
const DONE = 'done'

// Buildings per current phase, in the project's phase order (bar chart).
function byPhase(facts) {
  const keys = [...facts.phaseKeys, DONE]
  return keys.map((phaseKey) => ({ phaseKey, count: facts.buildings.filter((b) => b.currentPhase === phaseKey).length }))
}
const buildingRow = (b) => ({ id: b.id, code: b.code, name: b.name, salCode: b.salCode, countryCode: b.countryCode, currentPhase: b.currentPhase, progress: b.progress, overdue: b.overdue, atRisk: b.atRisk, openBlockers: b.openBlockers, validation: b.validation, dguv: { compliantPct: b.dguv.compliantPct, total: b.dguv.counts.total, worst: b.dguv.worst } })
// A person's figures — only for those who may see them (Org Admin, PM).
const personRow = (p) => ({ userId: p.userId, name: p.name, role: p.role, assigned: p.assigned, primaryFor: p.primaryFor, openTasks: p.openTasks, overdueTasks: p.overdueTasks, completed30: p.completed30 })

const INSTALLED_DEVICE = ['installed', 'configured', 'tested', 'accepted', 'in_service', 'maintenance']
const INSTALLED_LINK = ['installed', 'tested', 'accepted', 'faulty']
const lower = (v) => String(v ?? '').toLowerCase()

// The approved procurement BOM and the as-built of each building, for BOM
// accuracy (addendum v2.3 Q15): serialised devices installed, optics on
// installed links (as recorded on site, else as designed) and installed
// cables by medium. A building is finished when its deployment is complete;
// it is dated by its deployment completion (phase history), else by the last
// acceptance on site.
async function asInstalled(buildingIds, bomRows, history, tz) {
  const ids = buildingIds.map((b) => new mongoose.Types.ObjectId(b))
  const [statuses, records, links] = await Promise.all([
    deploymentStatusesByBuilding(),
    DeploymentRecord.find({ buildingId: { $in: ids }, status: { $in: INSTALLED_DEVICE } }, { buildingId: 1, deviceId: 1, acceptedAt: 1 }).lean(),
    ConnectionRecord.find({ buildingId: { $in: ids }, status: { $in: INSTALLED_LINK } }, { buildingId: 1, connectionId: 1, installed: 1 }).lean(),
  ])
  const designed = new Map((await Connection.find({ _id: { $in: links.map((l) => l.connectionId) } }, { media: 1, sourceSfpCode: 1, destSfpCode: 1 }).lean()).map((c) => [String(c._id), c]))
  return buildingIds.map((buildingId) => {
    const latest = bomRows.filter((v) => v.buildingId === buildingId).sort((a, b) => b.number - a.number)[0]
    if (!latest?.lines) return { buildingId, approved: null }
    const approved = { devices: 0, optics: {}, cables: {} }
    const deviceKeys = new Set()
    let notComparable = 0
    for (const l of latest.lines) {
      const [kind, code] = l.key.split(':')
      if (kind === 'device') {
        approved.devices += 1
        deviceKeys.add(l.key)
      } else if (kind === 'optic') approved.optics[code] = (approved.optics[code] ?? 0) + l.qty
      else if (kind === 'cable') approved.cables[code] = (approved.cables[code] ?? 0) + l.qty
      else notComparable += 1
    }
    const installed = { devices: records.filter((r) => String(r.buildingId) === buildingId && deviceKeys.has(`device:${r.deviceId}`)).length, optics: {}, cables: {} }
    for (const link of links.filter((l) => String(l.buildingId) === buildingId)) {
      const design = designed.get(String(link.connectionId)) ?? {}
      for (const code of [link.installed?.sourceSfpCode ?? design.sourceSfpCode, link.installed?.destSfpCode ?? design.destSfpCode].filter(Boolean)) installed.optics[lower(code)] = (installed.optics[lower(code)] ?? 0) + 1
      const media = link.installed?.media ?? design.media
      const cables = (link.installed?.segments ?? []).filter((s) => s.cableId).length
      if (media && cables) installed.cables[media] = (installed.cables[media] ?? 0) + cables
    }
    const completed = [...history].reverse().find((h) => String(h.buildingId) === buildingId && h.phaseKey === 'deployment')
    const lastAccepted = records.filter((r) => String(r.buildingId) === buildingId && r.acceptedAt).map((r) => r.acceptedAt).sort((a, b) => b - a)[0]
    const on = completed?.event === 'completed' && completed.dateKnown ? completed.on : localDay(lastAccepted, tz)
    return { buildingId, finished: statuses.deployment.get(buildingId) === 'completed', on, approved, installed, notComparable }
  })
}

// Dashboards, workload and analytics (brief v2.2 §21.5, §21.6, §21.9; M7a-3).
// Every figure is over the buildings the caller can open; figures about
// named people only for the Org Admin and PM; BOM values only for those who
// may see prices (D20).
export function createInsightsService({ lld, storage }) {
  return {
    // Project-level (v2.2 §21.6): buildings by phase, progress, overdue,
    // open validation errors, DGUV compliance, team utilisation.
    async project(req, { now = new Date() } = {}) {
      const facts = await projectFacts(req, { now, lld, withValidation: true })
      const people = await projectPeople(req, facts)
      const b = facts.buildings
      const validation = b.filter((x) => x.validation)
      return {
        today: facts.today,
        timeZone: facts.timeZone,
        scope: facts.scope,
        phases: facts.phaseKeys,
        byPhase: byPhase(facts),
        progress: avg(b.map((x) => x.progress)),
        overdue: { buildings: b.filter((x) => x.overdue.length).length, phases: b.flatMap((x) => x.overdue.map((o) => ({ buildingId: x.id, code: x.code, ...o }))) },
        atRisk: b.filter((x) => x.atRisk).length,
        validation: { critical: validation.reduce((n, x) => n + x.validation.critical, 0), warning: validation.reduce((n, x) => n + x.validation.warning, 0), buildings: validation.filter((x) => x.validation.critical > 0).map((x) => ({ buildingId: x.id, code: x.code, critical: x.validation.critical })) },
        dguv: summarise(facts.dguvItems),
        team: { ...utilisationOf(people), personLevel: facts.personLevel, ...(facts.personLevel ? { people: people.map(personRow) } : {}) },
        buildings: b.map(buildingRow),
      }
    },

    // Country / SAL rollup (v2.2 §21.6): buildings, average progress, overdue
    // count, and the BOM value for those who may see prices.
    async rollup(req, { now = new Date() } = {}) {
      const facts = await projectFacts(req, { now, lld, withBom: true })
      const priced = facts.pricesVisible
      const group = (list) => ({ buildings: list.length, avgProgress: avg(list.map((x) => x.progress)), overdue: list.filter((x) => x.overdue.length).length, ...(priced ? { bomValue: bomValueOf(list) } : {}) })
      const countries = new Map()
      for (const x of facts.buildings) {
        const ck = x.countryId ?? 'none'
        if (!countries.has(ck)) countries.set(ck, { countryId: x.countryId, code: x.countryCode, name: x.countryName, sals: new Map(), list: [] })
        const c = countries.get(ck)
        c.list.push(x)
        const sk = x.salId ?? 'none'
        if (!c.sals.has(sk)) c.sals.set(sk, { salId: x.salId, code: x.salCode, list: [] })
        c.sals.get(sk).list.push(x)
      }
      return {
        today: facts.today,
        scope: facts.scope,
        pricesVisible: priced,
        totals: group(facts.buildings),
        countries: [...countries.values()]
          .sort((a, b) => String(a.code).localeCompare(String(b.code)))
          .map((c) => ({
            countryId: c.countryId,
            code: c.code,
            name: c.name,
            ...group(c.list),
            sals: [...c.sals.values()].sort((a, b) => String(a.code).localeCompare(String(b.code))).map((s) => ({ salId: s.salId, code: s.code, ...group(s.list), buildingCodes: s.list.map((x) => x.code) })),
          })),
      }
    },

    // Organisation-level (v2.2 §21.6): the Org Admin sees every project,
    // anyone else the projects they are a member of; each project counted
    // over the buildings the caller can open there.
    async organisation(req, { now = new Date() } = {}) {
      const { organisationMembership } = await rolesIn(req.user._id, req.org.id)
      const isOrgAdmin = organisationMembership?.role === 'org_admin'
      const memberships = await membershipsForUser(req.user._id)
      const mine = new Set(memberships.filter((m) => m.level === 'project' && String(m.organisationId) === String(req.org.id)).map((m) => String(m.projectId)))
      const all = await runWithScope({ organisationId: req.org.id }, () => Project.find({}).sort({ createdAt: 1 }).lean())
      const projects = all.filter((p) => isOrgAdmin || mine.has(String(p._id)))
      const rows = []
      const people = new Map()
      let pricedProjects = 0
      for (const p of projects.filter((x) => x.status !== 'archived')) {
        const preq = { org: req.org, project: { id: String(p._id), doc: p }, user: req.user }
        const row = await runWithScope({ organisationId: req.org.id, projectId: p._id }, async () => {
          const facts = await projectFacts(preq, { now, lld, withBom: true })
          const team = await projectPeople(preq, facts)
          for (const person of team) {
            const k = person.userId
            if (!people.has(k)) people.set(k, { userId: k, name: person.name, openTasks: 0, named: null })
            const agg = people.get(k)
            agg.openTasks += person.openTasks
            // Named figures only from projects where the caller may see
            // figures per person — never another project's tasks.
            if (facts.personLevel) {
              agg.named ??= { projects: 0, openTasks: 0, overdueTasks: 0 }
              agg.named.projects += 1
              agg.named.openTasks += person.openTasks
              agg.named.overdueTasks += person.overdueTasks
            }
          }
          const slaTrouble = facts.schedule.slas.some((s) => ['at_risk', 'breached'].includes(s.status))
          if (facts.pricesVisible) pricedProjects += 1
          return {
            id: String(p._id),
            name: p.name,
            code: p.code ?? null,
            clientName: p.clientName ?? null,
            status: p.status,
            buildings: facts.buildings.length,
            scopeLimited: facts.scope.limited,
            progress: avg(facts.buildings.map((x) => x.progress)),
            overdue: facts.buildings.filter((x) => x.overdue.length).length,
            atRisk: facts.buildings.some((x) => x.atRisk) || slaTrouble,
            ...(facts.pricesVisible ? { bomValue: bomValueOf(facts.buildings) } : {}),
            _buildings: facts.buildings,
          }
        })
        rows.push(row)
      }
      const everyBuilding = rows.flatMap((r) => r._buildings)
      const priced = rows.filter((r) => r.bomValue)
      const peopleList = [...people.values()]
      const utilisation = { members: peopleList.length, active: peopleList.filter((x) => x.openTasks > 0).length }
      utilisation.utilisationPct = utilisation.members ? Math.round((utilisation.active / utilisation.members) * 100) : null
      const named = peopleList.filter((x) => x.named)
      return {
        isOrgAdmin,
        projects: rows.map(({ _buildings, ...r }) => r),
        archived: projects.filter((x) => x.status === 'archived').length,
        atRisk: rows.filter((r) => r.atRisk).map((r) => r.id),
        totals: {
          projects: rows.length,
          buildings: everyBuilding.length,
          progress: avg(everyBuilding.map((x) => x.progress)),
          overdue: everyBuilding.filter((x) => x.overdue.length).length,
          ...(priced.length ? { bomValue: { costMinor: priced.reduce((n, r) => n + r.bomValue.costMinor, 0), sellMinor: priced.reduce((n, r) => n + r.bomValue.sellMinor, 0), unpricedLines: priced.reduce((n, r) => n + r.bomValue.unpricedLines, 0), currency: priced.find((r) => r.bomValue.currency)?.bomValue.currency ?? null, projects: pricedProjects, hiddenProjects: rows.length - pricedProjects } } : {}),
        },
        // Cross-project utilisation: the counts for everyone; names only for
        // the people of projects where the caller is the Org Admin or a PM.
        utilisation: { ...utilisation, people: named.map((x) => ({ userId: x.userId, name: x.name, ...x.named })).sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name)) },
      }
    },

    // Workload matrix (v2.2 §21.5): member × building with task and overdue
    // counts, the buildings each person holds and their current phase. Org
    // Admin and PM only (the route checks); a scoped PM sees their buildings.
    async workload(req, { now = new Date() } = {}) {
      const facts = await projectFacts(req, { now, lld })
      const people = await projectPeople(req, facts)
      const columns = facts.buildings.map((b) => ({ id: b.id, code: b.code, name: b.name, currentPhase: b.currentPhase }))
      const totals = Object.fromEntries(columns.map((c) => [c.id, { tasks: 0, overdue: 0 }]))
      const projectWide = { tasks: 0, overdue: 0 }
      for (const p of people) {
        for (const [bid, cell] of Object.entries(p.cells)) {
          totals[bid].tasks += cell.tasks
          totals[bid].overdue += cell.overdue
        }
        projectWide.tasks += p.projectWide.tasks
        projectWide.overdue += p.projectWide.overdue
      }
      return {
        today: facts.today,
        scope: facts.scope,
        buildings: columns,
        people: people.map((p) => ({ ...personRow(p), cells: p.cells, projectWide: p.projectWide })),
        totals: { byBuilding: totals, projectWide, tasks: people.reduce((n, p) => n + p.openTasks, 0), overdue: people.reduce((n, p) => n + p.overdueTasks, 0) },
      }
    },

    // Analytics (v2.2 §21.9): six metrics with monthly trend lines, over the
    // caller's buildings. Rows with an unknown date are left out and counted.
    // Survey completion by technician: Org Admin and PM only.
    async analytics(req, { now = new Date() } = {}) {
      const facts = await projectFacts(req, { now, lld })
      const tz = facts.timeZone
      const scope = await projectScope(req)
      const ids = new Set(facts.buildings.map((b) => b.id))
      const inScope = (bid) => bid && ids.has(String(bid))
      const project = await Project.findById(req.project.id, { activePhases: 1 }).lean()
      const phaseKeys = (project?.activePhases ?? []).slice().sort((a, b) => a.position - b.position).map((p) => p.phaseKey).filter((p) => PHASE_KEYS.includes(p))
      const [history, targets, blockers, approvals, versions, rooms, records] = await Promise.all([
        PhaseHistory.find({}).sort({ recordedAt: 1, _id: 1 }).lean(),
        PhaseTarget.find({}, { buildingId: 1, phaseKey: 1, startDate: 1 }).lean(),
        Blocker.find({}, { buildingId: 1, salId: 1, phaseKey: 1, status: 1, raisedAt: 1, resolvedAt: 1 }).lean(),
        Approval.find({}, { buildingId: 1, gate: 1, status: 1, submittedAt: 1, decision: 1 }).lean(),
        DesignVersion.find({ designType: 'bom' }, { buildingId: 1, number: 1, createdAt: 1, snapshotFileId: 1 }).lean(),
        Room.find({}, { buildingId: 1 }).lean(),
        SurveyTabRecord.find({}, { buildingId: 1, roomId: 1, tab: 1, status: 1, submitted: 1, verified: 1 }).lean(),
      ])
      const startOf = new Map(targets.map((t) => [`${t.buildingId}|${t.phaseKey}`, t.startDate ?? null]))
      const phaseDuration = phaseDurations({ history: history.filter((h) => inScope(h.buildingId)).map((h) => ({ buildingId: String(h.buildingId), phaseKey: h.phaseKey, event: h.event, on: h.on, dateKnown: h.dateKnown })), phaseKeys, buildingIds: [...ids], startOf: (b, p) => startOf.get(`${b}|${p}`) ?? null })
      const scopedBlockers = blockers.filter((x) => scope.coversItem({ buildingId: x.buildingId ? String(x.buildingId) : null, salId: x.salId ? String(x.salId) : null })).map((x) => ({ phaseKey: x.phaseKey, status: x.status, raisedOn: localDay(x.raisedAt, tz), resolvedOn: localDay(x.resolvedAt, tz) }))
      const bomRows = []
      for (const v of versions.filter((x) => inScope(x.buildingId))) {
        const snapshot = await readSnapshot(storage, v.snapshotFileId).catch(() => null)
        bomRows.push({ buildingId: String(v.buildingId), number: v.number, on: localDay(v.createdAt, tz), lines: Array.isArray(snapshot?.lines) ? snapshot.lines.map((l) => ({ key: l.key, qty: l.qty })) : null })
      }
      const revisions = bomRevisions({ versions: bomRows })
      const accuracy = bomAccuracy({ buildings: await asInstalled([...ids], bomRows, history, tz) })
      const codeOf = new Map(facts.buildings.map((b) => [b.id, b.code]))
      // The tabs each building needs (its rooms), and what was done of them.
      let expected = 0
      const wanted = new Set()
      for (const b of facts.buildings) {
        const tabs = expectedSurveyTabs(rooms.filter((r) => String(r.buildingId) === b.id).map((r) => String(r._id)))
        expected += tabs.length
        for (const t of tabs) wanted.add(`${b.id}|${t.tab}|${t.roomId ?? ''}`)
      }
      const survey = surveyCompletion({ expected, records: records.filter((r) => inScope(r.buildingId) && wanted.has(`${r.buildingId}|${r.tab}|${r.roomId ? String(r.roomId) : ''}`)).map((r) => ({ status: r.status, submittedBy: r.submitted?.by ? String(r.submitted.by) : null, verifiedOn: localDay(r.verified?.at, tz) })) })
      let byTechnician
      if (facts.personLevel) {
        const names = new Map((await User.find({ _id: { $in: survey.byTechnician.map((x) => new mongoose.Types.ObjectId(x.userId)) } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u.name || u.email]))
        byTechnician = survey.byTechnician.map((x) => ({ ...x, name: names.get(x.userId) ?? 'Former member' }))
      }
      const surveyTotals = { ...survey }
      delete surveyTotals.byTechnician
      return {
        today: facts.today,
        timeZone: tz,
        scope: facts.scope,
        personLevel: facts.personLevel,
        metrics: {
          phaseDuration,
          blockerFrequency: blockerFrequency({ blockers: scopedBlockers }),
          blockerResolution: blockerResolution({ blockers: scopedBlockers }),
          bomAccuracy: { ...accuracy, buildings: accuracy.buildings.map((x) => ({ ...x, code: codeOf.get(x.buildingId) ?? null })) },
          bomRevisions: { ...revisions, buildings: revisions.buildings.map((x) => ({ ...x, code: codeOf.get(x.buildingId) ?? null })) },
          surveyCompletion: { ...surveyTotals, ...(byTechnician ? { byTechnician } : {}) },
          approvalTurnaround: approvalTurnaround({ approvals: approvals.filter((a) => inScope(a.buildingId)).map((a) => ({ gate: a.gate, status: a.status, submittedAt: a.submittedAt ?? null, decidedAt: a.decision?.decidedAt ?? null })), timeZone: tz }),
        },
      }
    },
  }
}
