import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, tokenFrom } from './helpers/app.js'
import { createOrganisationService } from '../src/organisations/service.js'
import { createAuthService } from '../src/auth/service.js'
import { parseTesterList, inviteTesters } from '../src/ops/testers.js'
import { runMigrations, MIGRATIONS } from '../src/ops/migrations.js'
import { loadConfig } from '../src/config/index.js'
import { createLogger } from '../src/logger.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DEPLOY = path.join(here, '../../deploy')
const read = (name) => fs.readFileSync(path.join(DEPLOY, name), 'utf8')

describe('The deploy files (docs/DEPLOY-DEMO.md)', () => {
  it('PM2 runs exactly one instance, in fork mode, with no secret in the file', () => {
    const { apps } = createRequire(import.meta.url)(path.join(DEPLOY, 'ecosystem.config.cjs'))
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ name: 'rackium-api', exec_mode: 'fork', instances: 1, script: 'src/index.js' })
    expect(apps[0].env).toBeUndefined()
  })

  it('Nginx: HTTPS, HTTP redirected, the real client address, gzip, the SPA, security headers wherever it serves files, room for the API’s own limits', () => {
    const conf = read('nginx/rackium.conf.template')
    expect(conf).toMatch(/listen 443 ssl/)
    expect(conf).toMatch(/return 301 https:\/\/\$host\$request_uri/)
    expect(conf).toMatch(/\.well-known\/acme-challenge/)
    // Replaced, never appended: TRUST_PROXY=1 believes this header.
    expect(conf).toMatch(/proxy_set_header X-Forwarded-For \$remote_addr;/)
    expect(conf).not.toMatch(/\$proxy_add_x_forwarded_for/)
    expect(conf).toMatch(/gzip on/)
    expect(conf).toMatch(/try_files \$uri \$uri\/ \/index\.html/)
    expect(conf).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:4000/)
    // Each block that sets its own add_header must include the headers again.
    const fileBlocks = [...conf.matchAll(/location (?:\/assets\/|\/) \{[^}]*\}/g)].map((m) => m[0]).filter((b) => b.includes('add_header'))
    expect(fileBlocks).toHaveLength(2)
    for (const block of fileBlocks) expect(block).toContain('include snippets/rackium-security-headers.conf')
    // The API's limits: 6 MB of JSON, 2 MB chunks.
    const [, mb] = conf.match(/client_max_body_size (\d+)m/)
    expect(Number(mb)).toBeGreaterThanOrEqual(6)
    const app = fs.readFileSync(path.join(here, '../src/app.js'), 'utf8')
    expect(app).toContain("limit: '6mb'")
  })

  it('the security headers: a CSP with no inline script, framing refused, HSTS', () => {
    const headers = read('nginx/security-headers.conf')
    const csp = headers.match(/Content-Security-Policy "([^"]+)"/)[1]
    expect(csp).toContain("script-src 'self';")
    expect(csp).not.toMatch(/script-src[^;]*unsafe/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    for (const name of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Permissions-Policy']) expect(headers).toContain(`add_header ${name} `)
  })

  it('MongoDB: localhost only, users required, a replica set', () => {
    const conf = read('mongod.conf')
    expect(conf).toMatch(/bindIp: 127\.0\.0\.1$/m)
    expect(conf).toMatch(/authorization: enabled/)
    expect(conf).toMatch(/replSetName: rs0/)
    expect(conf).toMatch(/keyFile:/)
  })

  it('the environment template, once filled in, is a production configuration the server accepts — and refuses unfilled', () => {
    const parse = (text) => Object.fromEntries(text.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    const template = read('rackium.env.template')
    const filled = template.replaceAll('@DOMAIN@', 'test.example.net').replaceAll('@MONGO_APP_PASSWORD@', 'pw').replaceAll('@JWT_SECRET@', 'x'.repeat(48))
    const env = { ...parse(filled), CHROMIUM_PATH: process.execPath }
    // Refused until the one value set by hand is set.
    expect(() => loadConfig(env)).toThrow(/RESEND_API_KEY/)
    const config = loadConfig({ ...env, RESEND_API_KEY: 're_real' })
    expect(config).toMatchObject({ IS_PRODUCTION: true, TRUST_PROXY: 1, SIGNUP_ENABLED: false, ENV_BANNER: 'Test environment — do not enter real customer data', CLIENT_ORIGIN: 'https://test.example.net', FILE_STORAGE_DIR: '/var/lib/rackium/files' })
    expect(template).toMatch(/CHROMIUM_PATH=\/usr\/bin\/google-chrome-stable/)
  })

  it('the firewall opens only 22, 80 and 443; secrets are generated, not printed; backups rotate at 35 days and leave the server', () => {
    const setup = read('setup-ubuntu.sh')
    expect([...setup.matchAll(/ufw allow (\S+)/g)].map((m) => m[1])).toEqual(['22/tcp', '80/tcp', '443/tcp'])
    expect(setup).toMatch(/ufw default deny incoming/)
    expect(setup).not.toMatch(/echo .*(PASSWORD|SECRET)|cat .*(mongo-admin|rackium\.env|passphrase)/)
    const backup = read('backup.sh')
    expect(setup).toMatch(/BACKUP_KEEP_DAYS=35/)
    expect(backup).toMatch(/rclone copyto/)
    expect(backup).toMatch(/rclone delete .*--min-age/)
    expect(backup).toMatch(/--symmetric --cipher-algo AES256/)
    expect(backup).toMatch(/--oplog/)
    expect(backup).not.toMatch(/--password|-p \$/)
  })
})

describe('Inviting testers: the list', () => {
  it('name, email, role; comma, semicolon or tab; a header and comments are skipped; roles by key or label', () => {
    const { testers, problems } = parseTesterList('﻿name,email,role\n# the first group\nAna Tester, Ana@Real.test ,architect\n"Field, Fred";fred@real.test;Field Engineer\nCara\tcara@real.test\tExternal Reviewer\n')
    expect(problems).toEqual([])
    expect(testers).toEqual([
      { name: 'Ana Tester', email: 'ana@real.test', role: 'architect' },
      { name: 'Field, Fred', email: 'fred@real.test', role: 'field_engineer' },
      { name: 'Cara', email: 'cara@real.test', role: 'external_reviewer' },
    ])
  })
  it('says everything wrong at once, by line', () => {
    const { problems } = parseTesterList('Ana,not-an-email,viewer\n,b@real.test,viewer\nCid,c@real.test,superuser\nDee,d@real.test,viewer\nDee2,D@real.test,viewer\nEve,e@real.test,viewer,extra')
    expect(problems).toEqual([
      'Line 1: "not-an-email" is not an email address',
      'Line 2: no name',
      expect.stringMatching(/^Line 3: "superuser" is not a role/),
      'Line 5: d@real.test is listed twice',
      'Line 6: expected name, email, role',
    ])
  })
})

describe('With a database', () => {
  let replSet
  beforeAll(async () => {
    replSet = await startReplSet()
  })
  afterAll(async () => {
    await stopReplSet(replSet)
  })
  beforeEach(async () => {
    await clearAll()
  })

  async function demoOrg(ctx) {
    const owner = await signedInOrgAdmin(ctx, { organisationName: 'Test Org' })
    await owner.agent.post(`/api/v1/orgs/${owner.orgId}/projects`).send({ name: 'Demo', code: 'DEM' }).expect(201)
    const logger = createLogger({ level: 'silent' })
    const auth = createAuthService({ config: ctx.config, mailer: ctx.mailer, logger })
    return { owner, org: createOrganisationService({ mailer: ctx.mailer, auth }) }
  }

  it('testers are invited by email, the link only to them; run again, nobody is invited twice; a dry run sends nothing', async () => {
    const ctx = createTestApp()
    const { org } = await demoOrg(ctx)
    const testers = [{ name: 'Ana Tester', email: 'ana@real.test', role: 'architect' }, { name: 'Olaf', email: 'olaf@real.test', role: 'org_admin' }]
    const args = { org, organisationName: 'Test Org', projectCode: 'DEM', testers }
    const before = ctx.mailer.sent.length
    expect((await inviteTesters({ ...args, dryRun: true })).map((r) => r.outcome)).toEqual(['would_invite', 'would_invite'])
    expect(ctx.mailer.sent.length).toBe(before)
    const results = await inviteTesters(args)
    expect(results.map((r) => r.outcome)).toEqual(['invited', 'invited'])
    // No token in what the script prints from.
    expect(JSON.stringify(results)).not.toMatch(/token/i)
    expect(ctx.mailer.lastTo('ana@real.test').text).toContain('/invite')
    expect((await inviteTesters(args)).map((r) => r.outcome)).toEqual(['invitation_pending', 'invitation_pending'])
    expect(ctx.mailer.sent.length).toBe(before + 2)
    await expect(inviteTesters({ ...args, projectCode: 'NOPE' })).rejects.toThrow(/No project/)
    await expect(inviteTesters({ ...args, organisationName: 'Nobody' })).rejects.toThrow(/No organisation/)

    // The tester accepts without typing a name: it is the one on the list.
    const token = tokenFrom(ctx.mailer, 'ana@real.test')
    const owner = await mongoose.connection.db.collection('organisations').findOne({ name: 'Test Org' })
    const res = await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: String(owner._id), token, password: 'a long enough password' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect((await mongoose.connection.db.collection('users').findOne({ email: 'ana@real.test' })).name).toBe('Ana Tester')
    expect((await inviteTesters({ ...args, testers: [testers[0]] }))[0].outcome).toBe('already_member')
  }, 120000)

  it('migrations run once each, in order, and are recorded; a failing one stops the run and is not recorded', async () => {
    createTestApp()
    const ran = []
    const list = [{ id: 'a', run: async () => ran.push('a') }, { id: 'b', run: async () => ran.push('b') }]
    expect(await runMigrations({ migrations: list })).toEqual({ ran: ['a', 'b'], skipped: 0 })
    expect(await runMigrations({ migrations: list })).toEqual({ ran: [], skipped: 2 })
    expect(ran).toEqual(['a', 'b'])
    const failing = [...list, { id: 'c', run: async () => { throw new Error('boom') } }, { id: 'd', run: async () => ran.push('d') }]
    await expect(runMigrations({ migrations: failing })).rejects.toThrow('boom')
    expect(ran).toEqual(['a', 'b'])
    expect(await mongoose.connection.db.collection('opsMigrations').countDocuments({ _id: 'c' })).toBe(0)
  }, 60000)

  it('the real list starts with the phase history backfill, which runs on an empty database and again without harm', async () => {
    createTestApp()
    expect(MIGRATIONS[0].id).toBe('2026-10-phase-history-backfill')
    expect((await runMigrations()).ran).toContain('2026-10-phase-history-backfill')
    expect((await runMigrations()).ran).toEqual([])
    expect(new Set(MIGRATIONS.map((m) => m.id)).size).toBe(MIGRATIONS.length)
  }, 60000)
})
