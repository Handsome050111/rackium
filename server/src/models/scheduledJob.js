import mongoose from 'mongoose'

// The Mongo-backed scheduler (M5b): one row per job. A run is claimed by
// setting a lock with an atomic update, so with several server processes only
// one runs a job at a time; `nextRunAt` moves on when the run ends. Global.
const scheduledJobSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  nextRunAt: { type: Date, required: true },
  lockedUntil: { type: Date, default: null },
  lockedBy: { type: String, default: null },
  lastRunAt: { type: Date, default: null },
  lastResult: { type: mongoose.Schema.Types.Mixed, default: null },
  lastError: { type: String, default: null },
})

export const ScheduledJob = mongoose.models.ScheduledJob || mongoose.model('ScheduledJob', scheduledJobSchema)
