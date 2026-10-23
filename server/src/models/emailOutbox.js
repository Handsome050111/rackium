import mongoose from 'mongoose'

// Outgoing notification mail (M5b). Written in the same transaction as the
// event that caused it, sent afterwards by the outbox job, so a rolled-back
// action never sends mail and a crash never loses one. Server-internal and
// global (the job serves every organisation); `dedupeKey` makes each message
// unique — a daily digest is `digest:<org>:<user>:<date>`, so a re-run of the
// digest job sends nothing twice.
const emailOutboxSchema = new mongoose.Schema({
  organisationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  to: { type: String, required: true },
  subject: { type: String, required: true },
  text: { type: String, required: true },
  kind: { type: String, enum: ['notification', 'digest', 'dguv_weekly', 'report'], required: true },
  // The weekly DGUV digest (M7a-2): one row per user and send date, each
  // reminder appended once as it is claimed; sent at `notBefore`.
  items: { type: [new mongoose.Schema({ title: String, link: String, projectName: String }, { _id: false })], default: undefined },
  dedupeKey: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: null },
  lockedUntil: { type: Date, default: null },
  // Grouping (M5b review): an immediate mail waits until `notBefore`, so a
  // burst of the same event becomes one email with a count.
  notBefore: { type: Date, default: null },
  groupKey: { type: String, default: null },
  count: { type: Number, default: 1 },
  createdAt: { type: Date, default: () => new Date() },
  sentAt: { type: Date, default: null },
})
emailOutboxSchema.index({ status: 1, createdAt: 1 })

export const EmailOutbox = mongoose.models.EmailOutbox || mongoose.model('EmailOutbox', emailOutboxSchema)
