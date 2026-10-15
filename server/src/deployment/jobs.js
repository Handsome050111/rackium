import { DGUV_STATUS_LABEL } from '@rackium/shared/deployment.js'
import { Organisation } from '../models/organisation.js'
import { Project } from '../models/project.js'
import { Building } from '../models/building.js'
import { DeploymentRecord } from '../models/deploymentRecord.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { notifyDguvExpiry, notifyDguvNotInspected, paths } from '../notifications/notify.js'
import { dguvDevices } from './asBuilt.js'

// DGUV V3 reminders (brief §6.9; M6a), to the PMs in scope, for installed
// mains-powered devices (retired records are out):
// - an inspection that is Expiring soon, Expiring or Overdue — on the
//   organisation's local date and with its intervals — once per level and
//   due date;
// - a device installed but never inspected — once per device (M6a review).
// Each reminder is claimed on the record first, so two runners never both send.
export async function dguvReminders({ now = new Date() } = {}) {
  const out = { sent: 0, notInspected: 0 }
  const orgs = await Organisation.find({ deletedAt: null }, { _id: 1 }).lean()
  for (const org of orgs) {
    const projects = await runWithScope({ organisationId: org._id }, () => Project.find({}, { _id: 1 }).lean())
    for (const project of projects) {
      await runWithScope({ organisationId: org._id, projectId: project._id }, async () => {
        const list = await dguvDevices({ organisationId: org._id, projectId: project._id, now })
        const codes = new Map((await Building.find({ _id: { $in: list.map((d) => d.rec.buildingId) } }, { code: 1 }).lean()).map((b) => [String(b._id), b.code]))
        for (const { rec, label, inspected, status } of list) {
          const key = inspected ? (status.status === 'valid' ? null : `${status.status}:${status.dueDate}`) : 'not_inspected'
          if (!key || (rec.dguv?.remindersSent ?? []).includes(key)) continue
          const claimed = await DeploymentRecord.findOneAndUpdate({ _id: rec._id, 'dguv.remindersSent': { $ne: key } }, { $addToSet: { 'dguv.remindersSent': key } })
          if (!claimed) continue
          const link = paths.building(String(org._id), String(project._id), String(rec.buildingId), 'deployment')
          if (inspected) {
            await notifyDguvExpiry({ projectId: String(project._id), buildingId: rec.buildingId, deviceLabel: label, expiresOn: status.dueDate, status: status.status, statusLabel: DGUV_STATUS_LABEL[status.status], link })
            out.sent += 1
          } else {
            await notifyDguvNotInspected({ projectId: String(project._id), buildingId: rec.buildingId, deviceLabel: label, buildingCode: codes.get(String(rec.buildingId)) ?? null, link })
            out.notInspected += 1
          }
        }
      })
    }
  }
  return out
}
