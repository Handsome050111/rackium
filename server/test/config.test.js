import { describe, it, expect } from 'vitest'
import { loadConfig, ConfigError } from '../src/config/index.js'

const SECRET = 'a-real-random-secret-with-more-than-32-chars'
const base = {
  MONGODB_URI: 'mongodb://localhost:27017/rackium?replicaSet=rs0',
  JWT_SECRET: SECRET,
}
const prod = {
  ...base,
  NODE_ENV: 'production',
  PUBLIC_APP_URL: 'https://demo.example.com',
  CLIENT_ORIGIN: 'https://demo.example.com',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test_key',
}

const issuesFor = (env) => {
  try {
    loadConfig(env)
    return []
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError)
    return err.issues.map((i) => i.path.join('.'))
  }
}

describe('config', () => {
  it('loads with defaults in development', () => {
    const cfg = loadConfig({ ...base })
    expect(cfg.NODE_ENV).toBe('development')
    expect(cfg.PORT).toBe(4000)
    expect(cfg.EMAIL_PROVIDER).toBe('console')
    expect(cfg.IS_PRODUCTION).toBe(false)
  })

  it('refuses to start without a database URI', () => {
    expect(issuesFor({ JWT_SECRET: SECRET })).toContain('MONGODB_URI')
  })

  it('refuses a JWT secret shorter than 32 characters', () => {
    expect(issuesFor({ ...base, JWT_SECRET: 'short' })).toContain('JWT_SECRET')
  })

  it('refuses production with the example placeholder secret', () => {
    const placeholder = 'change-me-to-a-long-random-string-of-at-least-32-chars'
    expect(issuesFor({ ...prod, JWT_SECRET: placeholder })).toContain('JWT_SECRET')
  })

  it('refuses production over plain http', () => {
    expect(issuesFor({ ...prod, PUBLIC_APP_URL: 'http://demo.example.com' })).toContain('PUBLIC_APP_URL')
  })

  it('refuses production with the console email provider', () => {
    expect(issuesFor({ ...prod, EMAIL_PROVIDER: 'console' })).toContain('EMAIL_PROVIDER')
  })

  it('refuses resend without an API key', () => {
    expect(issuesFor({ ...base, EMAIL_PROVIDER: 'resend' })).toContain('RESEND_API_KEY')
  })

  it('loads a complete production configuration', () => {
    const cfg = loadConfig(prod)
    expect(cfg.IS_PRODUCTION).toBe(true)
    expect(Object.isFrozen(cfg)).toBe(true)
  })

  it('rejects a CLIENT_ORIGIN that is not a URL', () => {
    expect(issuesFor({ ...base, CLIENT_ORIGIN: 'not a url' })).toContain('CLIENT_ORIGIN')
  })
})
