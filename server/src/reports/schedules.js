import mongoose from 'mongoose'
import { requestProblem, typeOf } from '@rackium/shared/documents/types.js'
import { canSeePrices, ROLE_LABELS } from '@rackium/shared/policy.js'
import { scheduleDueOn, nextScheduleDate, describeSchedule } from '@rackium/shared/reports.js'
import { ReportSchedule } from '../models/reportSchedule.js'
import { EmailOutbox } from '../models/emailOutbox.js'
import { Membership } from '../models/membership.js'
import { Organisation } from '../models/organisation.js'
import { Project } from '../models/project.js'
import { User } from '../models/user.js'
import { rolesIn } from '../organisations/service.js'
import { membershipsForUser } from '../auth/service.js'
import { membershipScopes } from '../access/scope.js'
import { orgTimeSettings } from '../organisations/timeSettings.js'
import { recordAudit, userActor, systemActor } from '../audit/audit.js'
import { appUrl } from '../notifications/notify.js'
import { forEachProject } from '../notifications/jobs.js'
import { badRequest, notFound } from '../http/errors.js'

const oid = (v) => new mongoose.Types.ObjectId(String(v))

// Where a report email's link leads: the Reports screen, which needs sign-in
// and opens only the recipient's own copy.
export const reportLink = (organisationId, projectId, documentId) => `/orgs/${organisationId}/projects/${projectId}/reports?document=${documentId}`

// What a member may receive now (M7a-3): an active user with an active Org
// Admin membership of the organisation or an active membership of this
// project, with the roles and scope the report is made with.
export async function recipientAccess(organisationId, projectId, userId) {
  const user = await User.findById(userId, { name: 1, email: 1, status: 1 }).lean()
  if (!user || user.status !== 'active') return { ok: false }
  const { roles, organisationMembership } = await rolesIn(userId, organisationId, projectId)
  if (!roles.length) return { ok: false }
  const isOrgAdmin = organisationMembership?.role === 'org_admin'
  const membership = (await membershipsForUser(userId)).find((m) => m.level === 'project' && String(m.projectId) === String(projectId) && String(m.organisationId) === String(organisationId))
  const org = await Organisation.findById(organisationId, { 'settings.architectsSeePrices': 1 }).lean()
  return { ok: true, user, roles, scopes: membershipScopes(membership, isOrgAdmin), canSeePrices: canSeePrices(roles, { architectsSeePrices: Boolean(org?.settings?.architectsSeePrices) }) }
}

// Why this member may not receive this report (null: they may).
const reportProblemFor = (access, s) => requestProblem({ typeKey: s.typeKey, format: s.format, options: { prices: s.prices }, roles: access.roles, canSeePrices: access.canSeePrices })

export function createReportScheduleService() {
  const audit = (req, actor, action, s, extra = {}) => recordAudit({ organisationId: req.org.id, projectId: req.project.id, actor: userActor(actor.userId, actor.role), action, objectType: 'ReportSchedule', objectId: String(s._id), changeType: 'design_intent', source: 'ui', ...extra })

  // Every recipient must be a member with access who may receive this report.
  async function checkRecipients(req, ids, s) {
    for (const userId of [...new Set(ids)]) {
      const access = await recipientAccess(req.org.id, req.project.id, userId)
      if (!access.ok) throw badRequest('Every recipient must be an active member of this organisation with access to this project')
      const problem = reportProblemFor(access, s)
      if (problem) throw badRequest(`${access.user.name || access.user.email} cannot receive this report: ${problem}`)
    }
  }

  async function view(s, tz) {
    const users = new Map((await User.find({ _id: { $in: s.recipients.map((r) => r.userId) } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u]))
    return {
      id: String(s._id),
      name: s.name ?? null,
      typeKey: s.typeKey,
      typeName: typeOf(s.typeKey)?.name ?? s.typeKey,
      format: s.format,
      prices: s.prices,
      frequency: s.frequency,
      weekday: s.weekday,
      dayOfMonth: s.dayOfMonth,
      time: s.time,
      description: describeSchedule(s),
      paused: s.paused,
      lastSentOn: s.lastSentOn,
      nextOn: s.paused ? null : nextScheduleDate(s, new Date(), tz),
      recipients: s.recipients.map((r) => ({ userId: String(r.userId), name: users.get(String(r.userId))?.name || users.get(String(r.userId))?.email || 'Former member', stopped: Boolean(r.stoppedAt), stoppedAt: r.stoppedAt, stopReason: r.stopReason })),
    }
  }
  async function load(id) {
    const s = mongoose.isValidObjectId(id) ? await ReportSchedule.findById(id) : null
    if (!s) throw notFound('Schedule not found')
    return s
  }

  return {
    async list(req) {
      const { timeZone } = await orgTimeSettings(req.org.id)
      const rows = await ReportSchedule.find({}).sort({ createdAt: 1 }).lean()
      return { timeZone, schedules: await Promise.all(rows.map((s) => view(s, timeZone))) }
    },

    // Who can be chosen: the organisation's Org Admins and the project's
    // active members — by name, never an address typed in.
    async recipients(req) {
      const rows = await Membership.find({ $or: [{ level: 'organisation', role: 'org_admin' }, { level: 'project', projectId: oid(req.project.id) }], active: true }, { userId: 1, role: 1, level: 1 }).lean()
      const users = new Map((await User.find({ _id: { $in: rows.map((m) => m.userId) }, status: 'active' }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u]))
      const byUser = new Map()
      for (const m of rows) {
        const u = users.get(String(m.userId))
        if (!u) continue
        const k = String(m.userId)
        if (!byUser.has(k)) byUser.set(k, { userId: k, name: u.name || u.email, email: u.email, roles: [] })
        byUser.get(k).roles.push(m.role)
      }
      return { recipients: [...byUser.values()].map((r) => ({ ...r, roleLabels: r.roles.map((x) => ROLE_LABELS[x] ?? x) })).sort((a, b) => a.name.localeCompare(b.name)) }
    },

    async create(req, body, actor) {
      const { digestTime, timeZone } = await orgTimeSettings(req.org.id)
      const draft = { typeKey: body.typeKey, format: body.format, prices: body.prices ?? 'none', frequency: body.frequency, weekday: body.frequency === 'weekly' ? body.weekday : null, dayOfMonth: body.frequency === 'monthly' ? body.dayOfMonth : null, time: body.time ?? digestTime }
      await checkRecipients(req, body.recipientIds, draft)
      const [s] = await ReportSchedule.create([{ ...draft, name: body.name ?? null, recipients: [...new Set(body.recipientIds)].map((u) => ({ userId: oid(u) })), createdBy: actor.userId }])
      await audit(req, actor, 'report_schedule.created', s, { comment: `${typeOf(s.typeKey).name} ${s.format.toUpperCase()}, ${describeSchedule(s)}, ${s.recipients.length} recipient(s)` })
      return { schedule: await view(s.toObject(), timeZone) }
    },

    async update(req, id, body, actor) {
      const s = await load(id)
      const { timeZone } = await orgTimeSettings(req.org.id)
      const before = { format: s.format, prices: s.prices, frequency: s.frequency, weekday: s.weekday, dayOfMonth: s.dayOfMonth, time: s.time, paused: s.paused, name: s.name, recipients: s.recipients.map((r) => String(r.userId)) }
      for (const f of ['name', 'format', 'prices', 'frequency', 'weekday', 'dayOfMonth', 'time', 'paused']) if (body[f] !== undefined) s[f] = body[f]
      if (s.frequency === 'weekly' && s.weekday == null) throw badRequest('A weekly schedule needs a weekday')
      if (s.frequency === 'monthly' && s.dayOfMonth == null) throw badRequest('A monthly schedule needs a day of the month (1–28)')
      if (s.frequency === 'weekly') s.dayOfMonth = null
      else s.weekday = null
      const ids = body.recipientIds ? [...new Set(body.recipientIds)] : s.recipients.filter((r) => !r.stoppedAt).map((r) => String(r.userId))
      // Everyone it will be sent to is checked again (a new format or price mode may exclude someone).
      await checkRecipients(req, ids, s)
      if (body.recipientIds) {
        const kept = new Map(s.recipients.map((r) => [String(r.userId), r]))
        // Re-adding a stopped recipient (access given back) starts them again.
        s.recipients = ids.map((u) => (kept.get(u) && !kept.get(u).stoppedAt ? kept.get(u) : { userId: oid(u), addedAt: new Date() }))
      }
      s.updatedAt = new Date()
      await s.save()
      const after = { format: s.format, prices: s.prices, frequency: s.frequency, weekday: s.weekday, dayOfMonth: s.dayOfMonth, time: s.time, paused: s.paused, name: s.name, recipients: s.recipients.map((r) => String(r.userId)) }
      const changes = Object.keys(after).filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])).map((f) => ({ objectType: 'ReportSchedule', objectId: String(s._id), field: f, before: before[f], after: after[f] }))
      if (changes.length) await audit(req, actor, 'report_schedule.updated', s, { changes })
      return { schedule: await view(s.toObject(), timeZone) }
    },

    async remove(req, id, actor) {
      const s = await load(id)
      await ReportSchedule.deleteOne({ _id: s._id })
      await audit(req, actor, 'report_schedule.deleted', s, { comment: `${typeOf(s.typeKey).name}, ${describeSchedule(s)}` })
      return { deleted: String(s._id) }
    },
  }
}

// The job (every 15 minutes): each schedule due on the organisation's local
// date and time is claimed for that date, then each recipient still with
// access gets their own report (their roles and scope) and an email with a
// sign-in link to it — never the file. A recipient who lost access, or may
// no longer receive this report, is stopped for good (audited).
export async function sendScheduledReports({ now = new Date(), documents }) {
  const out = { schedules: 0, reports: 0, stopped: 0 }
  await forEachProject(async ({ organisationId, projectId, timeZone }) => {
    const due = (await ReportSchedule.find({ paused: false }).lean()).filter((s) => scheduleDueOn(s, now, timeZone))
    if (!due.length) return
    const project = await Project.findById(projectId).lean()
    for (const s of due) {
      const on = scheduleDueOn(s, now, timeZone)
      const claimed = await ReportSchedule.findOneAndUpdate({ _id: s._id, paused: false, lastSentOn: { $ne: on } }, { $set: { lastSentOn: on, lastRunAt: now } })
      if (!claimed) continue
      out.schedules += 1
      for (const r of s.recipients.filter((x) => !x.stoppedAt)) {
        const access = await recipientAccess(organisationId, projectId, r.userId)
        const reason = !access.ok ? 'access_removed' : reportProblemFor(access, s) ? 'not_allowed' : null
        if (reason) {
          await ReportSchedule.updateOne({ _id: s._id, 'recipients.userId': r.userId }, { $set: { 'recipients.$.stoppedAt': now, 'recipients.$.stopReason': reason } })
          await recordAudit({ organisationId, projectId, actor: systemActor(), action: 'report_schedule.recipient_stopped', objectType: 'ReportSchedule', objectId: String(s._id), changeType: 'system', source: 'system', comment: `${reason === 'access_removed' ? 'Access removed' : 'May no longer receive this report'}: recipient ${String(r.userId)}` })
          out.stopped += 1
          continue
        }
        const req = { org: { id: organisationId }, project: { id: projectId, doc: project }, user: { _id: r.userId }, access: { roles: access.roles, scopes: access.scopes } }
        const { document } = await documents.enqueue(req, { buildingId: null, typeKey: s.typeKey, format: s.format, options: { prices: s.prices } }, { userId: r.userId, role: access.roles[0] }, { source: 'system' })
        const name = typeOf(s.typeKey).name
        const text = [
          `Your scheduled ${name} for ${project?.name ?? 'your project'} (${on}) is ready in Rackium.`,
          '',
          `Open it (sign-in required): ${appUrl()}${reportLink(organisationId, projectId, document.id)}`,
          '',
          'The report is not attached to this email: sign in to download it. It covers what your role and scope in the project allow.',
          `Schedule: ${s.name ? `${s.name} — ` : ''}${describeSchedule(s)} (${timeZone}).`,
        ].join('\n')
        try {
          await EmailOutbox.create({ organisationId: oid(organisationId), userId: r.userId, to: access.user.email, subject: `Rackium: ${name} — ${project?.name ?? ''}`.trim(), text, kind: 'report', dedupeKey: `report:${s._id}:${r.userId}:${on}` })
        } catch (err) {
          if (err.code !== 11000) throw err
        }
        out.reports += 1
      }
    }
  })
  return out
}
