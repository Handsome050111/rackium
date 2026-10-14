import { dguvStatus, DGUV_STATUS_LABEL } from '@rackium/shared/deployment.js'
import { localDate } from '@rackium/shared/timeZone.js'
import { Organisation } from '../models/organisation.js'
import { Project } from '../models/project.js'
import { Device } from '../models/device.js'
import { DeploymentRecord } from '../models/deploymentRecord.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { orgTimeSettings } from '../organisations/timeSettings.js'
import { notifyDguvExpiry, paths } from '../notifications/notify.js'

// DGUV V3 reminders (brief §6.9; M6a): once a recorded inspection is
// Expiring soon, Expiring or Overdue — on the organisation's local date and
// with its intervals — the PMs in scope are told, once per level and due
// date. The level is claimed on the record first, so two runners never both send.
export async function dguvReminders({ now = new Date() } = {}) {
  const out = { sent: 0 }
  const orgs = await Organisation.find({ deletedAt: null }, { _id: 1 }).lean()
  for (const org of orgs) {
    const { timeZone, dguv } = await orgTimeSettings(org._id)
    const today = localDate(now, timeZone)
    const projects = await runWithScope({ organisationId: org._id }, () => Project.find({}, { _id: 1 }).lean())
    for (const project of projects) {
      await runWithScope({ organisationId: org._id, projectId: project._id }, async () => {
        const records = await DeploymentRecord.find({ 'dguv.lastInspectionDate': { $ne: null } }).lean()
        for (const rec of records) {
          const s = dguvStatus({ lastInspectionDate: rec.dguv.lastInspectionDate, mainsPowered: true }, today, dguv)
          if (!s || s.status === 'valid') continue
          const key = `${s.status}:${s.dueDate}`
          if ((rec.dguv.remindersSent ?? []).includes(key)) continue
          const claimed = await DeploymentRecord.findOneAndUpdate({ _id: rec._id, 'dguv.remindersSent': { $ne: key } }, { $addToSet: { 'dguv.remindersSent': key } })
          if (!claimed) continue
          const device = await Device.findById(rec.deviceId, { hostname: 1, label: 1 }).lean()
          await notifyDguvExpiry({
            projectId: String(project._id),
            buildingId: rec.buildingId,
            deviceLabel: device?.hostname ?? device?.label ?? 'a device',
            expiresOn: s.dueDate,
            status: s.status,
            statusLabel: DGUV_STATUS_LABEL[s.status],
            link: paths.building(String(org._id), String(project._id), String(rec.buildingId), 'deployment'),
          })
          out.sent += 1
        }
      })
    }
  }
  return out
}
