import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { loadConfig, ConfigError } from './config/index.js'
import { createLogger } from './logger.js'
import { connectDatabase, disconnectDatabase } from './db/connect.js'
import { createApp, VERSION } from './app.js'
import { createEmailSender } from './email/index.js'
import { seedPlatformCatalogue } from './catalogue/seed.js'
import { Device } from './models/device.js'
import { PortOccupancy } from './models/portOccupancy.js'
import { CableIdRegistry } from './models/cableIdRegistry.js'
import { createScheduler } from './jobs/scheduler.js'
import { deliverOutbox, taskReminders, dailyDigest } from './notifications/jobs.js'
import { dguvReminders } from './deployment/jobs.js'
import { scheduleAlerts } from './schedule/service.js'
import { forEachProject } from './notifications/jobs.js'
import { closePdfBrowserIfLoaded } from './documents/render/chromium.js'
import { configureNotifications } from './notifications/notify.js'
import { sendScheduledReports } from './reports/schedules.js'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true })

async function main() {
  let config
  try {
    config = loadConfig()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message) // the logger is not configured yet
      process.exit(1)
    }
    throw err
  }

  const logger = createLogger({ level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' })
  await connectDatabase(config.MONGODB_URI)
  logger.info({ version: VERSION, env: config.NODE_ENV }, 'database connected (replica set)')
  // M4b made hostname, port and cable-ID uniqueness per design layer: replace
  // the older project-wide unique indexes on databases created before it.
  for (const Model of [Device, PortOccupancy, CableIdRegistry]) await Model.syncIndexes()
  const seeded = await seedPlatformCatalogue()
  logger.info(seeded, 'platform catalogue seeded (placeholder data; existing rows untouched)')

  const mailer = createEmailSender({ provider: config.EMAIL_PROVIDER, from: config.EMAIL_FROM, apiKey: config.RESEND_API_KEY, logger })
  const app = createApp({ config, logger, mailer })
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'api listening'))

  // Scheduled jobs (M5b): notification mail, task reminders, the daily digest.
  const scheduler = createScheduler({
    logger,
    jobs: [
      { name: 'email-outbox', every: 60_000, run: ({ now }) => deliverOutbox({ mailer, now }) },
      { name: 'task-reminders', every: 15 * 60_000, run: ({ now }) => taskReminders({ now }) },
      // Every 15 minutes: each organisation's digest goes once its local digest time has passed.
      { name: 'daily-digest', every: 15 * 60_000, run: ({ now }) => dailyDigest({ now }) },
      // DGUV V3 reminders (M6a): each level once per due date, on the local date.
      { name: 'dguv-reminders', every: 60 * 60_000, run: ({ now }) => dguvReminders({ now }) },
      { name: 'schedule-alerts', every: 15 * 60_000, run: ({ now }) => scheduleAlerts({ now, forEachProject }) },
      // Generated documents (M6b): queued jobs, and any whose run died. Requests also start it at once.
      { name: 'documents', every: 15_000, run: ({ now }) => app.__documents.process({ now }) },
      // Scheduled reports (M7a-3): each at its local day and time; the email links to the recipient's own copy.
      { name: 'report-schedules', every: 15 * 60_000, run: ({ now }) => sendScheduledReports({ now, documents: app.__documents }) },
    ],
  })
  // Queued notification mail goes out promptly, not only on the minute.
  configureNotifications({ onOutbox: () => scheduler.runNow('email-outbox').catch((err) => logger.error({ err: err.message }, 'outbox send failed')) })
  await scheduler.start()

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down')
    scheduler.stop()
    closePdfBrowserIfLoaded()
    server.close(async () => {
      await disconnectDatabase()
      process.exit(0)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
