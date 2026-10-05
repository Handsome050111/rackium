import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { loadConfig, ConfigError } from './config/index.js'
import { createLogger } from './logger.js'
import { connectDatabase, disconnectDatabase } from './db/connect.js'
import { createApp, VERSION } from './app.js'
import { createEmailSender } from './email/index.js'

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

  const mailer = createEmailSender({ provider: config.EMAIL_PROVIDER, from: config.EMAIL_FROM, apiKey: config.RESEND_API_KEY, logger })
  const app = createApp({ config, logger, mailer })
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'api listening'))

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down')
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
