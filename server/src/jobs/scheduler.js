import crypto from 'node:crypto'
import { ScheduledJob } from '../models/scheduledJob.js'

// A small Mongo-backed scheduler (M5b). Each job has one row; a run is
// claimed with an atomic update that sets a lock, so only one process runs a
// job at a time even with several servers, and a crashed run's lock simply
// expires. `every` (ms) repeats; `dailyAtUtc` ('HH:MM') runs once a day.
// The jobs themselves are idempotent, so a run repeated after a crash is harmless.

export function nextRunAfter(job, from) {
  if (job.every) return new Date(from.getTime() + job.every)
  const [h, m] = job.dailyAtUtc.split(':').map(Number)
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), h, m))
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

export function createScheduler({ jobs, logger, tickMs = 30000, lockMs = 10 * 60000 }) {
  const instance = crypto.randomUUID()
  let timer = null
  let running = false

  async function ensureRows(now) {
    for (const job of jobs) {
      await ScheduledJob.updateOne({ name: job.name }, { $setOnInsert: { name: job.name, nextRunAt: job.every ? now : nextRunAfter(job, now) } }, { upsert: true })
    }
  }

  // Runs every job that is due and not claimed elsewhere.
  async function tick(now = new Date()) {
    const results = {}
    for (const job of jobs) {
      const claimed = await ScheduledJob.findOneAndUpdate(
        { name: job.name, nextRunAt: { $lte: now }, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
        { $set: { lockedUntil: new Date(now.getTime() + lockMs), lockedBy: instance } },
        { returnDocument: 'after' }
      )
      if (!claimed) continue
      try {
        results[job.name] = await job.run({ now })
        await ScheduledJob.updateOne({ name: job.name, lockedBy: instance }, { $set: { lockedUntil: null, lastRunAt: now, nextRunAt: nextRunAfter(job, now), lastResult: results[job.name] ?? null, lastError: null } })
      } catch (err) {
        logger?.error({ err: err.message, job: job.name }, 'scheduled job failed')
        await ScheduledJob.updateOne({ name: job.name, lockedBy: instance }, { $set: { lockedUntil: null, nextRunAt: new Date(now.getTime() + 60000), lastError: err.message } })
      }
    }
    return results
  }

  // Runs one job now if no other process holds it (used to send mail promptly).
  async function runNow(name) {
    const job = jobs.find((j) => j.name === name)
    if (!job || running) return null
    running = true
    try {
      return await job.run({ now: new Date() })
    } finally {
      running = false
    }
  }

  return {
    instance,
    tick,
    runNow,
    async start() {
      await ensureRows(new Date())
      const loop = async () => {
        try {
          await tick()
        } catch (err) {
          logger?.error({ err: err.message }, 'scheduler tick failed')
        }
        timer = setTimeout(loop, tickMs)
        timer.unref?.()
      }
      await loop()
    },
    stop() {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
