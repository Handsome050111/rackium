import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

// Placeholder values from .env.example. Refusing these in production stops a
// copied example file from reaching the public server.
const PLACEHOLDER_SECRETS = ['change-me-to-a-long-random-string-of-at-least-32-chars']
const originOf = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z.string({ error: 'MONGODB_URI is required' }).min(1, 'MONGODB_URI is required'),
    JWT_SECRET: z.string({ error: 'JWT_SECRET is required' }).min(32, 'JWT_SECRET must be at least 32 characters'),
    CLIENT_ORIGIN: z.url({ error: 'CLIENT_ORIGIN must be a URL' }).default('http://localhost:5173'),
    PUBLIC_APP_URL: z.url({ error: 'PUBLIC_APP_URL must be a URL' }).default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().min(3).default('Rackium <no-reply@localhost>'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    // Local-disk file store (DATA-MODEL §9, hosting: files on the VPS disk behind a storage interface).
    FILE_STORAGE_DIR: z.string().min(1).default('var/files'),
    // Generated documents (M6b): a system Chromium for PDFs (empty: Playwright's
    // own download), and whether this process renders queued documents itself.
    CHROMIUM_PATH: z.string().optional(),
    DOCUMENTS_AUTO_PROCESS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // Public sign-up creates a new organisation: on by default for development,
    // off by default in production (testers are invited).
    SIGNUP_ENABLED: z.enum(['true', 'false']).optional(),
    // A line shown on every screen, e.g. "Test environment — do not enter real
    // customer data". Empty: no banner.
    ENV_BANNER: z.string().trim().max(200).optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.EMAIL_PROVIDER === 'resend' && !cfg.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend' })
    }
    if (cfg.NODE_ENV === 'production') {
      if (PLACEHOLDER_SECRETS.includes(cfg.JWT_SECRET)) {
        ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET is still the example placeholder' })
      }
      if (!cfg.PUBLIC_APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['PUBLIC_APP_URL'], message: 'PUBLIC_APP_URL must be https in production' })
      }
      // The server's env template (deploy/rackium.env.template) until someone fills it in.
      if (cfg.RESEND_API_KEY === '__SET_ME__') {
        ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is still the template placeholder' })
      }
      if (cfg.EMAIL_PROVIDER !== 'resend') {
        ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'EMAIL_PROVIDER must be resend in production' })
      }
      // The browser's origin: https, and the app the emails link to.
      if (!cfg.CLIENT_ORIGIN.startsWith('https://') || originOf(cfg.CLIENT_ORIGIN) !== originOf(cfg.PUBLIC_APP_URL)) {
        ctx.addIssue({ code: 'custom', path: ['CLIENT_ORIGIN'], message: 'CLIENT_ORIGIN must be https and the same origin as PUBLIC_APP_URL in production' })
      }
      // Exactly one proxy (Nginx): 0 puts every user behind Nginx's address for
      // rate limits; more would trust an address the client can send.
      if (cfg.TRUST_PROXY !== 1) {
        ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'TRUST_PROXY must be 1 in production (one Nginx in front)' })
      }
      if (!cfg.CHROMIUM_PATH) {
        ctx.addIssue({ code: 'custom', path: ['CHROMIUM_PATH'], message: 'CHROMIUM_PATH is required in production (documents are rendered with it)' })
      } else if (!fs.existsSync(cfg.CHROMIUM_PATH)) {
        ctx.addIssue({ code: 'custom', path: ['CHROMIUM_PATH'], message: `CHROMIUM_PATH does not exist: ${cfg.CHROMIUM_PATH}` })
      }
      if (!path.isAbsolute(cfg.FILE_STORAGE_DIR)) {
        ctx.addIssue({ code: 'custom', path: ['FILE_STORAGE_DIR'], message: 'FILE_STORAGE_DIR must be an absolute path in production (it must outlive a release)' })
      }
    }
  })

export class ConfigError extends Error {
  constructor(issues) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

// Validates the environment once at startup. Throws ConfigError so the process
// exits before it opens a port or touches the database.
export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env)
  if (!parsed.success) throw new ConfigError(parsed.error.issues)
  const IS_PRODUCTION = parsed.data.NODE_ENV === 'production'
  const SIGNUP_ENABLED = parsed.data.SIGNUP_ENABLED ? parsed.data.SIGNUP_ENABLED === 'true' : !IS_PRODUCTION
  return Object.freeze({ ...parsed.data, IS_PRODUCTION, SIGNUP_ENABLED, ENV_BANNER: parsed.data.ENV_BANNER || null })
}
