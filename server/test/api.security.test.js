import fs from 'node:fs'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember } from './helpers/app.js'
import { errorHandler } from '../src/http/errorHandler.js'
import { DEFAULT_RATE_LIMITS } from '../src/app.js'
import { createEmailSender } from '../src/email/index.js'

// The release's security sweep (docs/DEPLOY-DEMO.md): every route the app has,
// read from the app itself, so a route added later is checked without anyone
// remembering to.

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

const t = () => createTestApp()
const NO_ID = '0'.repeat(24)
const fill = (path, ids = {}) => path.replace(/[{:](\w+)}?/g, (_, name) => ids[name] ?? NO_ID)
const call = (agent, { method, path }, ids) => {
  const m = method.toLowerCase()
  return agent[m](fill(path, ids)).send(m === 'get' || m === 'delete' ? undefined : {})
}

// Open to anyone, on purpose: what signing in itself needs, the public client
// approval and download links (each token-protected), health and client config.
const PUBLIC = [/^\/api\/v1\/health$/, /^\/api\/v1\/client-config$/, /^\/api\/v1\/openapi\.json$/, /^\/api\/v1\/auth\//, /^\/api\/v1\/public\//]
const isPublic = (path) => PUBLIC.some((p) => p.test(path))

const VALIDATE_FIRST = [
  'patch /blockers/{id}', // RAISE_BLOCKER in front; owner or PM in the service
  'patch /cmdb/records/{deviceId}', // requireEditor
  'patch /files/uploads/{fileId}', // the file's WRITERS
  'patch /tasks/{id}', // assigner, assignee or PM
  'post /blockers', // RAISE_BLOCKER: every project role may
  'post /cmdb/lifecycle-import', // requireEditor
  'post /deployment/connections/{connectionId}/test', // connectionStepProblem
  'post /deployment/devices/{deviceId}/status', // deviceStepProblem
  'post /deployment/exceptions', // Field Engineer
  'post /deployment/exceptions/{exceptionId}/review', // Reviewer or PM
  'post /documents', // documentRequestProblem, by type and role
  'post /documents/share-links', // PM
  'post /files/uploads', // the attachment's WRITERS
  'post /hld/uplinks/check', // writes nothing
  'post /survey/racks/{rackId}/ru-states', // Architect reserves, PM blocks
  'post /survey/records/edits', // the tab rules, by role
  'post /survey/records/transitions', // the tab rules, by role
  'post /survey/sync', // the tab rules, by role
  'put /deployment/connections/{connectionId}/installation', // Field Engineer
  'put /deployment/devices/{deviceId}/dguv', // Field Engineer or PM
  'put /deployment/devices/{deviceId}/dguv-override', // MANAGE_DGUV_EXEMPTIONS
  'put /deployment/devices/{deviceId}/installation', // Field Engineer
  'put /handover/buildings/{buildingId}/old-gear', // PM
  'post /validation-rules/preview', // Org Admin or Architect; reads only
].sort()

describe('Every route is guarded', () => {
  it('without a session, every route but the public ones answers 401', async () => {
    const ctx = t()
    const routes = ctx.app.__apiRoutes.filter((r) => !isPublic(r.path))
    expect(routes.length).toBeGreaterThan(200)
    const open = []
    for (const route of routes) {
      const res = await call(request(ctx.app), route)
      if (res.status !== 401) open.push(`${route.method} ${route.path}: ${res.status}`)
    }
    expect(open).toEqual([])
    // The list of public routes is short and each is meant to be.
    const publicRoutes = ctx.app.__apiRoutes.filter((r) => isPublic(r.path)).map((r) => r.path)
    expect(publicRoutes.every((p) => /\/(health|client-config|openapi\.json)$|\/auth\/|\/public\//.test(p))).toBe(true)
  }, 120000)

  it('a member of another organisation reaches nothing of this one: every organisation and project route answers 403 or 404', async () => {
    const ctx = t()
    const owner = await signedInOrgAdmin(ctx)
    const { body } = await owner.agent.post(`/api/v1/orgs/${owner.orgId}/projects`).send({ name: 'Ours', code: 'OUR' }).expect(201)
    const stranger = await signedInOrgAdmin(ctx, { email: 'stranger@example.com', organisationName: 'Other Org' })
    const routes = ctx.app.__apiRoutes.filter((r) => r.path.startsWith('/api/v1/orgs/') && !r.path.endsWith('/orgs'))
    const leaks = []
    for (const route of routes) {
      const res = await call(stranger.agent, route, { orgId: owner.orgId, projectId: body.project.id })
      if (![403, 404].includes(res.status)) leaks.push(`${route.method} ${route.path}: ${res.status}`)
    }
    expect(leaks).toEqual([])
  }, 240000)

  it('a Viewer writes nothing: no project write succeeds, none fails with a 500', async () => {
    const ctx = t()
    const owner = await signedInOrgAdmin(ctx)
    const { body } = await owner.agent.post(`/api/v1/orgs/${owner.orgId}/projects`).send({ name: 'Ours', code: 'OUR' }).expect(201)
    const projectId = body.project.id
    const viewer = await projectMember(ctx, owner, { email: 'viewer@example.com', role: 'viewer', projectId })
    const routes = ctx.app.__apiRoutes.filter((r) => r.path.includes('/projects/') && r.method.toLowerCase() !== 'get')
    const seen = []
    for (const route of routes) {
      const res = await call(viewer, route, { orgId: owner.orgId, projectId })
      seen.push({ route: `${route.method} ${route.path}`, status: res.status })
    }
    if (process.env.ROUTE_AUDIT_FILE) fs.writeFileSync(process.env.ROUTE_AUDIT_FILE, seen.map((s) => `${s.status} ${s.route}`).join('\n'))
    expect(seen.filter((s) => s.status >= 500)).toEqual([])
    // What a Viewer is meant to do (raise a blocker, read a report) needs a real
    // body: with this empty one nothing may get through.
    expect(seen.filter((s) => s.status < 300)).toEqual([])
    // These check the body first and the role in the service (each read for this
    // release, and tested with its module). A new route answering 400 here has
    // no role check in front of it: review it, then add it.
    const validateFirst = seen.filter((s) => s.status === 400).map((s) => s.route.replace(/^(\w+) \/api\/v1\/orgs\/\{orgId\}\/projects\/\{projectId\}/, '$1 ')).sort()
    expect(validateFirst).toEqual(VALIDATE_FIRST)
    expect(seen.length).toBeGreaterThan(100)
  }, 240000)
})

describe('What the API gives away', () => {
  it('an unexpected error says nothing about why; the log has it', () => {
    const logged = []
    const res = { headersSent: false, status: vi.fn(() => res), json: vi.fn() }
    errorHandler({ error: (...a) => logged.push(a) })(new Error('connect ECONNREFUSED mongodb://rackium:s3cret@10.0.0.1'), { id: 'r1' }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'internal', message: 'Something went wrong', requestId: 'r1' } })
    expect(logged).toHaveLength(1)
  })

  it('a duplicate key does not name the index; a malformed body does not echo the parser', async () => {
    const res = { headersSent: false, status: vi.fn(() => res), json: vi.fn() }
    errorHandler({ error: () => {} })(Object.assign(new Error('E11000 duplicate key error collection: rackium.users index: email_1'), { code: 11000 }), { id: 'r2' }, res, () => {})
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/E11000|email_1|rackium\./)
    const ctx = t()
    const bad = await request(ctx.app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":')
    expect(bad.status).toBe(400)
    expect(JSON.stringify(bad.body)).not.toMatch(/position|Unexpected|SyntaxError|node_modules/)
  })

  it('health says only that the app and database are up; sign-in errors do not say which part was wrong', async () => {
    const ctx = t()
    expect((await request(ctx.app).get('/health').expect(200)).body).toEqual({ status: 'ok', app: 'up', database: 'up' })
    await signedInOrgAdmin(ctx)
    const wrongPassword = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'not the right password at all' })
    const noUser = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'not the right password at all' })
    expect(wrongPassword.status).toBe(noUser.status)
    expect(wrongPassword.body.error.message).toBe(noUser.body.error.message)
  })

  it('a production server does not publish its API map; the security headers are on', async () => {
    const ctx = createTestApp({ config: { IS_PRODUCTION: true } })
    await request(ctx.app).get('/api/v1/openapi.json').expect(404)
    const res = await request(ctx.app).get('/api/v1/client-config').expect(200)
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['strict-transport-security']).toBeTruthy()
    expect(res.headers['x-powered-by']).toBeUndefined()
    await request(t().app).get('/api/v1/openapi.json').expect(200)
  })

  it('session cookies are httpOnly, SameSite=Strict, and Secure in production', async () => {
    const ctx = createTestApp({ config: { IS_PRODUCTION: true } })
    // Over plain http, a Secure cookie would not come back to supertest: sign in with a separate app, same database.
    const dev = t()
    await signedInOrgAdmin(dev)
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'correct horse battery staple' }).expect(200)
    const cookies = res.headers['set-cookie']
    expect(cookies.length).toBeGreaterThan(0)
    for (const cookie of cookies) expect(cookie).toMatch(/HttpOnly/)
    for (const cookie of cookies) expect(cookie).toMatch(/SameSite=Strict/)
    for (const cookie of cookies) expect(cookie).toMatch(/Secure/)
  })

  it('a request id is taken from the caller only in a safe shape', async () => {
    const ctx = t()
    expect((await request(ctx.app).get('/api/v1/health').set('X-Request-Id', 'abc-123')).headers['x-request-id']).toBe('abc-123')
    const hostile = (await request(ctx.app).get('/api/v1/health').set('X-Request-Id', '<script>alert(1)</script>')).headers['x-request-id']
    expect(hostile).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('Limits and closed doors', () => {
  it('sign-up can be closed: refused by the API, and the client is told', async () => {
    const closed = createTestApp({ config: { SIGNUP_ENABLED: false, ENV_BANNER: 'Test environment' } })
    const res = await request(closed.app).post('/api/v1/auth/signup').send({ organisationName: 'New', name: 'A', email: 'a@example.com', password: 'correct horse battery staple' })
    expect(res.status).toBe(403)
    expect((await request(closed.app).get('/api/v1/client-config').expect(200)).body).toEqual({ banner: 'Test environment', signupEnabled: false })
    expect((await request(t().app).get('/api/v1/client-config').expect(200)).body).toEqual({ banner: null, signupEnabled: true })
  })

  it('every API call counts against a ceiling per address; health does not', async () => {
    const ctx = createTestApp({ rateLimits: { ...DEFAULT_RATE_LIMITS, api: { windowMs: 60000, limit: 3, message: 'Too many requests.' } } })
    for (let i = 0; i < 3; i++) await request(ctx.app).get('/api/v1/client-config').expect(200)
    const limited = await request(ctx.app).get('/api/v1/client-config')
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('rate_limited')
    await request(ctx.app).get('/api/v1/health').expect(200)
    await request(ctx.app).get('/health').expect(200)
  })

  it('the default limits are on, and tighter on sign-in than on everything else', () => {
    expect(DEFAULT_RATE_LIMITS.enabled).toBe(true)
    expect(DEFAULT_RATE_LIMITS.login.limit).toBeLessThan(DEFAULT_RATE_LIMITS.api.limit)
  })

  it('no mail goes to reserved example addresses: demo users on a test server cannot cause bounces', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } }))
    try {
      const mailer = createEmailSender({ provider: 'resend', from: 'R <r@real.test>', apiKey: 're_test', logger: {} })
      await mailer.send({ to: 'viewer@example.com', subject: 's', text: 't' })
      expect(fetchSpy).not.toHaveBeenCalled()
      await mailer.send({ to: 'tester@real.test', subject: 's', text: 't' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('Uploads', () => {
  it('a file is judged by its bytes, not its name; what is too large or not allowed is refused', async () => {
    const { sniffKind, looksLikeCsv, limitBytesFor } = await import('../src/files/sniff.js')
    const html = Buffer.from('<!doctype html><script>alert(1)</script>')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(sniffKind(html)).toBe(null)
    expect(sniffKind(svg)).toBe(null)
    expect(looksLikeCsv(Buffer.from([0x4d, 0x5a, 0x00, 0x01]), 'text/csv', 'x.csv')).toBe(false)
    expect(sniffKind(Buffer.from('%PDF-1.7'))).toMatchObject({ kind: 'pdf' })
    expect(limitBytesFor('photo')).toBe(15 * 1024 * 1024)
    expect(limitBytesFor('pdf')).toBe(25 * 1024 * 1024)
    expect(limitBytesFor('sheet')).toBe(10 * 1024 * 1024)
  })
})
