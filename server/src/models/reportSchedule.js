import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'
import { REPORT_KEYS, REPORT_FORMATS, SCHEDULE_FREQUENCIES } from '@rackium/shared/reports.js'

const { ObjectId } = mongoose.Schema.Types

// A scheduled report (M7a-3, brief v2.2 §21.9): one of the seven standard
// reports, weekly or monthly at a local time in the organisation's time zone,
// to members of the project — never to a free-text address. Each recipient
// gets their own copy, made with their roles and scope; the email carries a
// sign-in link, never the file. A recipient who has lost access (or may no
// longer receive this report) is stopped at the next send, for good.
const recipientSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, required: true },
    addedAt: { type: Date, default: () => new Date() },
    stoppedAt: { type: Date, default: null },
    stopReason: { type: String, enum: ['access_removed', 'not_allowed', null], default: null },
  },
  { _id: false }
)

const reportScheduleSchema = new mongoose.Schema({
  name: { type: String, default: null, trim: true, maxlength: 120 },
  typeKey: { type: String, enum: REPORT_KEYS, required: true },
  format: { type: String, enum: REPORT_FORMATS, required: true },
  prices: { type: String, enum: ['none', 'sell', 'cost'], default: 'none' },
  frequency: { type: String, enum: SCHEDULE_FREQUENCIES, required: true },
  weekday: { type: Number, min: 0, max: 6, default: null },
  dayOfMonth: { type: Number, min: 1, max: 28, default: null },
  // Local 'HH:MM' in the organisation's time zone.
  time: { type: String, required: true },
  recipients: { type: [recipientSchema], default: [] },
  paused: { type: Boolean, default: false },
  // The local date it was last sent on: claimed before sending, so a send
  // day is served once even with two servers or a repeated job run.
  lastSentOn: { type: String, default: null },
  lastRunAt: { type: Date, default: null },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
})

reportScheduleSchema.__modelName = 'ReportSchedule'
tenantScope(reportScheduleSchema, { scope: 'project' })
reportScheduleSchema.index({ projectId: 1, paused: 1 })

export const ReportSchedule = mongoose.models.ReportSchedule || mongoose.model('ReportSchedule', reportScheduleSchema)
