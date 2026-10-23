import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { requestProblem, typeOf, fileNameOf, FORMAT_MIME, DOCUMENT_TYPES, COST_ROLES, clientShareProblem, isPersonalDocument } from '@rackium/shared/documents/types.js'
import { canSeePrices } from '@rackium/shared/policy.js'
import { localDate } from '@rackium/shared/timeZone.js'
import { GeneratedDocument } from '../models/generatedDocument.js'
import { File } from '../models/file.js'
import { Organisation } from '../models/organisation.js'
import { Project } from '../models/project.js'
import { User } from '../models/user.js'
import { HldDesign } from '../models/hldDesign.js'
import { LldDesign } from '../models/lldDesign.js'
import { SolutionPackage } from '../models/solutionPackage.js'
import { BomDesign } from '../models/bomDesign.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, badRequest, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding, buildingWithScopeIds } from '../access/scope.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { orgTimeSettings } from '../organisations/timeSettings.js'
import { projectSettings } from '../delivery/common.js'
import { generate } from './generate.js'
import { Connection } from '../models/connection.js'
import { ConnectionRecord } from '../models/connectionRecord.js'
import { withTransaction } from '../db/transaction.js'
import { createLink, prepareSecrets, linksOf } from '../delivery/shareLinks.js'

const AUDIT_READERS = ['org_admin', 'pm', 'architect', 'reviewer']
const MAX_ATTEMPTS = 3
const LOCK_MS = 10 * 60 * 1000
const oid = (v) => new mongoose.Types.ObjectId(String(v))
const STEP_PROGRESS = { 'Reading the data': 10, 'Collecting photos': 30, 'Laying out pages': 50, 'Writing the table of contents': 75, 'Writing the Word document': 60, 'Printing labels': 60, 'Storing the file': 95 }

export const documentView = (d) => ({
  id: String(d._id),
  buildingId: d.buildingId ? String(d.buildingId) : null,
  typeKey: d.typeKey,
  typeName: typeOf(d.typeKey)?.name ?? d.typeKey,
  format: d.format,
  version: d.version,
  status: d.status,
  progress: d.progress,
  step: d.step,
  error: d.error,
  options: d.options ?? {},
  requestedBy: d.requestedByName,
  requestedAt: d.requestedAt,
  finishedAt: d.finishedAt,
  fileName: d.fileName,
  sizeBytes: d.sizeBytes,
  pageCount: d.pageCount ?? null,
  sha256: d.sha256,
  handoverRound: d.handover?.round ?? null,
})

// Stable JSON for the request key (options in key order).
const stable = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null))

// The document engine (brief v2.2 §10; M6b): requests become queued jobs;
// one processor (claimed per job, so a second server or a repeated run never
// duplicates one) renders them and stores the file through the file service.
export function createDocumentService({ storage, services, autoProcess = true, logger = null }) {
  let running = false
  let again = false

  async function sourceVersions(buildingId) {
    if (!buildingId) return []
    const [hld, lld, sp, bom] = await Promise.all([HldDesign.findOne({ buildingId }, { latestApprovedVersionId: 1 }).lean(), LldDesign.findOne({ buildingId }, { latestApprovedVersionId: 1 }).lean(), SolutionPackage.findOne({ buildingId }, { latestApprovedVersionId: 1 }).lean(), BomDesign.findOne({ buildingId }, { approvedVersionId: 1 }).lean()])
    return [hld?.latestApprovedVersionId, lld?.latestApprovedVersionId, sp?.latestApprovedVersionId, bom?.approvedVersionId].filter(Boolean)
  }

  // Who may see a document: the building in scope; audit exports for their
  // readers; priced exports only for those who may see prices.
  async function assertReadable(req, d) {
    if (d.buildingId) await requireBuilding(req, d.buildingId)
    // A report was made with its requester's roles and scope (M7a-3): theirs alone.
    if (isPersonalDocument(d) && String(d.requestedBy) !== String(req.user._id)) throw notFound('Document not found')
    const { roles } = await callerAccess(req)
    if (d.typeKey === 'audit-log' && !roles.some((r) => AUDIT_READERS.includes(r))) throw notFound('Document not found')
    const prices = d.options?.prices ?? 'none'
    // Internal cost-price documents: Org Admin, PM and Reviewer only.
    if (prices === 'cost' && !roles.some((r) => COST_ROLES.includes(r))) throw notFound('Document not found')
    if (prices === 'sell') {
      const org = await Organisation.findById(req.org.id, { 'settings.architectsSeePrices': 1 }).lean()
      if (!canSeePrices(roles, { architectsSeePrices: Boolean(org?.settings?.architectsSeePrices) })) throw notFound('Document not found')
    }
  }

  async function load(req, id) {
    const d = mongoose.isValidObjectId(id) ? await GeneratedDocument.findById(id).lean() : null
    if (!d) throw notFound('Document not found')
    await assertReadable(req, d)
    return d
  }

  // Queues a document, or returns the identical request already queued or
  // generating. `handover`: { workflowId, round } when compiling a package.
  async function enqueue(req, { buildingId, typeKey, format, options = {}, handover = null }, actor, { session = null, source = 'ui' } = {}) {
    // A handover package goes to the client: never cost prices.
    if (handover && clientShareProblem({ options })) throw badRequest('A handover package cannot contain cost prices')
    const access = await callerAccess(req)
    const building = buildingId ? await requireBuilding(req, buildingId, session) : null
    const requestKey = crypto.createHash('sha256').update(stable({ buildingId: buildingId ?? null, typeKey, format, options, by: String(actor.userId), handover: handover ? String(handover.round) : null })).digest('hex')
    const active = await GeneratedDocument.findOne({ requestKey, status: { $in: ['queued', 'generating'] } }).session(session).lean()
    if (active) return { document: documentView(active), existing: true }
    const [org, user, time] = await Promise.all([Organisation.findById(req.org.id, { name: 1 }).session(session).lean(), User.findById(actor.userId, { name: 1, email: 1 }).session(session).lean(), orgTimeSettings(req.org.id, session)])
    const userName = user?.name || user?.email || 'user'
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await GeneratedDocument.findOne({ buildingId: building ? oid(building.id) : null, typeKey, format }).sort({ version: -1 }).session(session).lean()
      try {
        const [d] = await GeneratedDocument.create(
          [
            {
              buildingId: building ? building.id : null,
              typeKey,
              format,
              version: (last?.version ?? 0) + 1,
              options,
              requestKey,
              sourceVersionIds: await sourceVersions(building?.id ?? null),
              requestedBy: actor.userId,
              requestedByName: userName,
              requestedRoles: access.roles,
              requestedScopes: access.scopes ?? [],
              watermark: format === 'pdf' ? { organisation: org?.name ?? null, date: localDate(new Date(), time.timeZone), user: userName } : null,
              handover,
              fileId: new mongoose.Types.ObjectId(),
              fileName: fileNameOf({ buildingCode: building?.code ?? null, typeKey, version: (last?.version ?? 0) + 1, format }),
            },
          ],
          { session }
        )
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building?.id ?? null, phaseKey: handover ? 'handover' : null, actor: userActor(actor.userId, actor.role), action: 'document.requested', objectType: 'GeneratedDocument', objectId: String(d._id), changeType: 'system', source, comment: `${typeOf(typeKey).name} ${format.toUpperCase()} v${d.version}${options.prices && options.prices !== 'none' ? ` (prices: ${options.prices})` : ''}`, session })
        if (!session) kick()
        return { document: documentView(d.toObject()), existing: false }
      } catch (err) {
        if (err.code !== 11000) throw err
      }
    }
    throw new AppError(409, 'busy', 'Too many requests for this document at once — try again')
  }

  // The requester's context, rebuilt for a background job.
  async function jobReq(job) {
    const project = await Project.findById(job.projectId).lean()
    return { org: { id: String(job.organisationId) }, project: { id: String(job.projectId), doc: project, summary: { name: project?.name ?? null, code: project?.code ?? null, clientName: project?.clientName ?? null } }, user: { _id: job.requestedBy }, access: { roles: job.requestedRoles ?? [], scopes: job.requestedScopes ?? [] } }
  }

  async function branding(req) {
    const [org, settings] = await Promise.all([Organisation.findById(req.org.id, { name: 1, 'settings.logo': 1 }).lean(), projectSettings()])
    const uri = async (logo) => (logo?.storageKey ? `data:${logo.mimeType};base64,${(await storage.read(logo.storageKey).catch(() => null))?.toString('base64') ?? ''}` : null)
    const clean = (u) => (u && !u.endsWith('base64,') ? u : null)
    return { organisationName: org?.name ?? null, organisationLogo: clean(await uri(org?.settings?.logo)), clientLogo: clean(await uri(settings.clientLogo)), headings: settings.cableScheduleHeadings }
  }

  // One job: claimed, generated, stored. Errors mark it failed with the message.
  async function runJob(raw) {
    const scope = { organisationId: raw.organisationId, projectId: raw.projectId }
    return runWithScope(scope, async () => {
      const job = await GeneratedDocument.findById(raw._id).lean()
      const step = async (text) => {
        await GeneratedDocument.updateOne({ _id: job._id, status: 'generating' }, { $set: { step: text, progress: STEP_PROGRESS[text] ?? 50, lockedUntil: new Date(Date.now() + LOCK_MS) } })
      }
      try {
        const req = await jobReq(job)
        const building = job.buildingId ? await buildingWithScopeIds(job.buildingId) : null
        const brand = await branding(req)
        const out = await generate({ job, req, building, services, storage, branding: brand, settings: { headings: brand.headings }, onStep: (t) => step(t).catch(() => {}) })
        await step('Storing the file')
        const buffer = Buffer.isBuffer(out.buffer) ? out.buffer : Buffer.from(out.buffer)
        const storageKey = `documents/${String(job.projectId)}/${String(job.fileId)}`
        await storage.put(storageKey, buffer)
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
        // The same file id on a repeated run: replaced, never duplicated.
        await File.deleteOne({ _id: job.fileId })
        await File.create({ _id: job.fileId, buildingId: job.buildingId, attachedTo: { type: 'generatedDocument', id: job._id }, category: 'document', fileName: job.fileName, storageKey, mimeType: FORMAT_MIME[job.format], sizeBytes: buffer.length, sha256, uploadedBy: job.requestedBy })
        await GeneratedDocument.updateOne({ _id: job._id }, { $set: { status: 'ready', progress: 100, step: null, error: null, lockedUntil: null, finishedAt: new Date(), sizeBytes: buffer.length, sha256, pageCount: out.pageCount ?? null } })
        await recordAudit({ organisationId: scope.organisationId, projectId: scope.projectId, buildingId: job.buildingId, phaseKey: job.handover ? 'handover' : null, actor: userActor(job.requestedBy), action: 'document.generated', objectType: 'GeneratedDocument', objectId: String(job._id), changeType: 'system', source: 'system', comment: `${job.fileName} (${buffer.length} bytes)` })
      } catch (err) {
        logger?.warn?.({ err: err.message, document: String(job._id) }, 'document generation failed')
        await GeneratedDocument.updateOne({ _id: job._id }, { $set: { status: 'failed', error: err.message?.slice(0, 500) ?? 'Generation failed', lockedUntil: null, finishedAt: new Date() } })
        await recordAudit({ organisationId: scope.organisationId, projectId: scope.projectId, buildingId: job.buildingId, actor: userActor(job.requestedBy), action: 'document.failed', objectType: 'GeneratedDocument', objectId: String(job._id), changeType: 'system', source: 'system', comment: err.message?.slice(0, 300) ?? null })
      }
      if (job.handover && services.handover) await services.handover.documentFinished(job).catch((err) => logger?.error?.({ err: err.message }, 'handover update failed'))
    })
  }

  // Processes queued jobs (and ones whose run died: lock expired), at most
  // `limit`. Each is claimed with one atomic update across all tenants.
  async function process({ now = new Date(), limit = 20 } = {}) {
    const out = { done: 0 }
    const col = GeneratedDocument.collection
    for (let i = 0; i < limit; i++) {
      const at = new Date()
      const claimed = await col.findOneAndUpdate(
        { $or: [{ status: 'queued' }, { status: 'generating', lockedUntil: { $lt: at }, attempts: { $lt: MAX_ATTEMPTS } }] },
        { $set: { status: 'generating', lockedUntil: new Date(at.getTime() + LOCK_MS), startedAt: at, step: 'Starting', progress: 5 }, $inc: { attempts: 1 } },
        { sort: { requestedAt: 1 }, returnDocument: 'after' }
      )
      const doc = claimed?.value !== undefined ? claimed.value : claimed
      if (!doc) break
      // One job's unexpected error never stops the others (the job's lock
      // expires and it is retried, at most MAX_ATTEMPTS times).
      try {
        await runJob(doc)
      } catch (err) {
        logger?.error?.({ err: err.message, document: String(doc._id) }, 'document job crashed')
      }
      out.done += 1
    }
    // A run that died too often is failed for good.
    await col.updateMany({ status: 'generating', lockedUntil: { $lt: now }, attempts: { $gte: MAX_ATTEMPTS } }, { $set: { status: 'failed', error: 'Generation did not finish', lockedUntil: null } })
    return out
  }

  // Starts processing now in this process (the scheduler also runs it).
  function kick() {
    if (!autoProcess) return
    if (running) {
      again = true
      return
    }
    running = true
    setImmediate(async () => {
      try {
        do {
          again = false
          await process()
        } while (again)
      } catch (err) {
        logger?.error?.({ err: err.message }, 'document processing failed')
      } finally {
        running = false
      }
    })
  }

  return {
    enqueue,
    process,
    kick,
    load,
    assertReadable,

    async request(req, body, actor) {
      const type = typeOf(body.typeKey)
      const { roles } = await callerAccess(req)
      const org = await Organisation.findById(req.org.id, { 'settings.architectsSeePrices': 1 }).lean()
      const problem = requestProblem({ typeKey: body.typeKey, format: body.format, options: body.options, roles, canSeePrices: canSeePrices(roles, { architectsSeePrices: Boolean(org?.settings?.architectsSeePrices) }) })
      if (problem) throw /Only/.test(problem) ? forbidden(problem) : badRequest(problem)
      if (type.scope !== 'project' && !body.buildingId) throw badRequest('Choose a building')
      if (body.typeKey === 'cable-labels' && !(body.options?.connectionIds ?? []).length) throw badRequest('Choose the cables to label')
      return enqueue(req, { buildingId: type.scope === 'project' ? null : body.buildingId, typeKey: body.typeKey, format: body.format, options: body.options ?? {} }, actor)
    },

    async list(req, { buildingId = null, typeKey = null }) {
      if (buildingId) await requireBuilding(req, buildingId)
      const filter = { buildingId: buildingId ? oid(buildingId) : null }
      if (typeKey) filter.typeKey = typeKey
      const rows = await GeneratedDocument.find(filter).sort({ requestedAt: -1 }).limit(200).lean()
      const out = []
      for (const d of rows) {
        try {
          await assertReadable(req, d)
          out.push(documentView(d))
        } catch {
          // Not for this caller (prices, audit log).
        }
      }
      return { documents: out, types: DOCUMENT_TYPES.filter((t) => !t.system).map((t) => ({ key: t.key, name: t.name, formats: t.formats, prices: Boolean(t.prices), scope: t.scope ?? 'building' })) }
    },

    async get(req, id) {
      return { document: documentView(await load(req, id)) }
    },

    // The file of a ready document; every download is audited.
    async open(req, id, actor, { via = 'ui' } = {}) {
      const d = await load(req, id)
      if (d.status !== 'ready') throw new AppError(409, 'not_ready', d.status === 'failed' ? `This document failed: ${d.error}` : 'This document is still being generated')
      const file = await File.findById(d.fileId).lean()
      if (!file) throw notFound('The file of this document is missing')
      await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: d.buildingId, actor: userActor(actor.userId, actor.role), action: 'document.downloaded', objectType: 'GeneratedDocument', objectId: String(d._id), changeType: 'system', source: via, comment: d.fileName })
      return { file, stream: storage.stream(file.storageKey) }
    },

    // Logos on generated documents (M6b): PNG or JPEG, at most 500 KB.
    async setLogo({ dataUrl, key, kind }) {
      const m = /^data:(image\/(png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '')
      if (!m) throw badRequest('The logo must be a PNG or JPEG image')
      const bytes = Buffer.from(m[3], 'base64')
      if (bytes.length > 500 * 1024) throw badRequest('The logo is too large (at most 500 KB)')
      const magic = bytes.subarray(0, 4).toString('hex')
      if (!(magic.startsWith('89504e47') || magic.startsWith('ffd8ff'))) throw badRequest('The logo must be a PNG or JPEG image')
      const storageKey = `branding/${key}/${kind}-${Date.now()}`
      await storage.put(storageKey, bytes)
      return { storageKey, mimeType: m[1], updatedAt: new Date() }
    },
    readLogo: (logo) => storage.read(logo.storageKey),

    // A time-limited download link for chosen documents (PM): password optional.
    async createDownloadLink(req, body, actor) {
      const { roles } = await callerAccess(req)
      if (!roles.includes('pm')) throw forbidden('Only a PM shares documents by link')
      const building = await requireBuilding(req, body.buildingId)
      const ids = [...new Set(body.documentIds)]
      const docs = await GeneratedDocument.find({ _id: { $in: ids.map(oid) }, buildingId: oid(building.id) }).lean()
      if (docs.length !== ids.length) throw notFound('Document not found')
      for (const d of docs) {
        await assertReadable(req, d)
        if (d.status !== 'ready') throw new AppError(409, 'not_ready', `${d.fileName} is not ready yet`)
        // Cost prices never reach a client.
        const internal = clientShareProblem(d)
        if (internal) throw badRequest(internal)
      }
      const secrets = await prepareSecrets(body.password, { optional: true })
      const link = await withTransaction(async (session) => {
        const l = await createLink({ building, kind: 'document_download', documentIds: docs.map((d) => d._id), label: body.label ?? null, secrets, expiryDays: body.expiryDays, actor, session })
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, actor: userActor(actor.userId, actor.role), action: 'share_link.created', objectType: 'ShareLink', objectId: String(l._id), changeType: 'system', source: 'ui', comment: `Download link for ${docs.map((d) => d.fileName).join(', ')}; expires ${l.expiresAt.toISOString().slice(0, 10)}${secrets.passwordHash ? '; password protected' : ''}`, session })
        return l
      })
      return { shareLink: { id: String(link._id), token: secrets.token, password: secrets.password, url: `/download/${secrets.token}`, expiresAt: link.expiresAt, hasPassword: Boolean(secrets.passwordHash) } }
    },
    async downloadLinks(req, buildingId) {
      const building = await requireBuilding(req, buildingId)
      return { shareLinks: (await linksOf(building.id)).filter((l) => l.kind === 'document_download') }
    },

    // Where a QR code on a cable label leads (M6b): the connection, for a
    // signed-in member whose scope covers its building (404 otherwise).
    async locateConnection(req, connectionId) {
      const conn = mongoose.isValidObjectId(connectionId) ? await Connection.findOne({ _id: connectionId, layer: 'lld' }, { buildingId: 1, source: 1 }).lean() : null
      if (!conn) throw notFound('Connection not found')
      const building = await requireBuilding(req, conn.buildingId)
      const accepted = await ConnectionRecord.exists({ connectionId: conn._id, status: 'accepted' })
      return { connectionId: String(conn._id), buildingId: building.id, buildingCode: building.code, deviceId: String(conn.source.deviceId), screen: accepted ? 'cmdb' : 'deployment' }
    },
  }
}
