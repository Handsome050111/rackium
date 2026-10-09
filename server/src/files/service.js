import crypto from 'node:crypto'
import mongoose from 'mongoose'
import sharp from 'sharp'
import { File } from '../models/file.js'
import { Upload } from '../models/upload.js'
import { Pathway } from '../models/pathway.js'
import { SurveyTabRecord } from '../models/surveyTabRecord.js'
import { Organisation } from '../models/organisation.js'
import { getTabDefinition, SURVEY_TEMPLATE_VERSION } from '@rackium/shared/surveyForm.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding, requireRack, requireRoom } from '../access/scope.js'
import { sniffKind, looksLikeCsv, CATEGORY_KINDS, limitBytesFor, declaredKind } from './sniff.js'

const THUMBNAIL_PX = 320
const tooLarge = (message) => new AppError(413, 'too_large', message)
const oid = (v) => new mongoose.Types.ObjectId(String(v))

// Who may add files where: survey forms are filled by the Field Engineer;
// room, rack and pathway evidence by anyone who edits the site structure.
const WRITERS = {
  surveyTabRecord: ['field_engineer'],
  room: ['org_admin', 'pm', 'architect', 'field_engineer'],
  rack: ['org_admin', 'pm', 'architect', 'field_engineer'],
  pathway: ['org_admin', 'pm', 'architect', 'field_engineer'],
}

// The attachment, checked for existence and the caller's scope; returns the
// stored form { type, id } and the building it lives in.
async function resolveAttachment(req, attachedTo) {
  if (attachedTo.type === 'surveyTab') {
    const tabDef = getTabDefinition(attachedTo.tab)
    if (!tabDef) throw notFound('No such survey tab')
    const building = await requireBuilding(req, attachedTo.buildingId)
    if ((tabDef.scope === 'room') !== Boolean(attachedTo.roomId)) throw badRequest('Room-scope tabs need a room; building tabs do not')
    if (attachedTo.roomId) {
      const { room } = await requireRoom(req, attachedTo.roomId)
      if (String(room.buildingId) !== building.id) throw notFound('Room not found in this building')
    }
    const filter = { buildingId: building.id, roomId: attachedTo.roomId ?? null, tab: tabDef.tab }
    let record = await SurveyTabRecord.findOne(filter)
    if (!record) {
      try {
        record = await SurveyTabRecord.create({ ...filter, templateVersion: SURVEY_TEMPLATE_VERSION, lastModifiedAt: new Date(0) })
      } catch (err) {
        if (err.code !== 11000) throw err
        record = await SurveyTabRecord.findOne(filter)
      }
    }
    return { attachedTo: { type: 'surveyTabRecord', id: record._id }, building }
  }
  if (attachedTo.type === 'room') {
    const { room, building } = await requireRoom(req, attachedTo.id)
    return { attachedTo: { type: 'room', id: room._id }, building }
  }
  if (attachedTo.type === 'rack') {
    const { rack, building } = await requireRack(req, attachedTo.id)
    return { attachedTo: { type: 'rack', id: rack._id }, building }
  }
  const pathway = mongoose.isValidObjectId(attachedTo.id) ? await Pathway.findById(attachedTo.id).lean() : null
  if (!pathway) throw notFound('Pathway not found')
  const { building } = await requireRoom(req, pathway.roomLowId)
  await requireRoom(req, pathway.roomHighId)
  return { attachedTo: { type: 'pathway', id: pathway._id }, building }
}

async function assertWriter(req, type) {
  const { roles } = await callerAccess(req)
  if (!WRITERS[type].some((r) => roles.includes(r))) throw forbidden(type === 'surveyTabRecord' ? 'Only the Field Engineer adds survey photos and files' : 'You cannot add files here')
}

export const toFileView = (f) => ({
  id: String(f._id),
  fileName: f.fileName,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  category: f.category,
  attachedTo: { type: f.attachedTo.type, id: String(f.attachedTo.id) },
  widthPx: f.widthPx ?? null,
  heightPx: f.heightPx ?? null,
  hasThumbnail: Boolean(f.thumbnailKey),
  capturedAt: f.capturedAt ?? null,
  caption: f.caption ?? null,
  uploadedAt: f.uploadedAt,
})

export function createFileService({ storage }) {
  // A file the caller may read: it must be in this project (tenant plugin)
  // and in a building within the caller's scope.
  async function readable(req, fileId) {
    const file = mongoose.isValidObjectId(fileId) ? await File.findOne({ _id: fileId, deletedAt: null }).lean() : null
    if (!file) throw notFound('File not found')
    await requireBuilding(req, file.buildingId)
    return file
  }

  return {
    async start(req, body, actor) {
      const { attachedTo, building } = await resolveAttachment(req, body.attachedTo)
      await assertWriter(req, attachedTo.type)
      const existingFile = await File.findById(body.fileId).lean()
      if (existingFile && String(existingFile.uploadedBy) !== String(actor.userId)) throw conflict('upload_exists', 'An upload with this id already exists')
      if (existingFile) return { fileId: body.fileId, receivedBytes: existingFile.sizeBytes, sizeBytes: existingFile.sizeBytes, completed: true, file: toFileView(existingFile) }
      const kind = declaredKind(body.mimeType, body.fileName)
      if (!kind || !CATEGORY_KINDS[body.category].includes(kind)) throw badRequest(`This type of file is not accepted for ${body.category.replace('_', ' ')}`)
      const org = await Organisation.findById(req.org.id, { 'settings.uploadLimitsMb': 1 }).lean()
      const limitBytes = limitBytesFor(kind, org?.settings?.uploadLimitsMb)
      if (body.sizeBytes > limitBytes) throw tooLarge(`Too large: the limit for this type is ${Math.round(limitBytes / 1024 / 1024)} MB`)

      // Resuming: the same fileId from the same user continues where it stopped.
      const existing = await Upload.findOne({ fileId: body.fileId }).lean()
      if (existing) {
        if (String(existing.createdBy) !== String(actor.userId) || existing.sha256 !== body.sha256) throw conflict('upload_exists', 'An upload with this id already exists')
        return { fileId: body.fileId, receivedBytes: existing.receivedBytes, sizeBytes: existing.sizeBytes, completed: false }
      }
      await Upload.create({
        fileId: body.fileId,
        buildingId: building.id,
        attachedTo,
        category: body.category,
        fileName: body.fileName,
        declaredMimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
        limitBytes,
        tempKey: `tmp/${req.project.id}/${body.fileId}`,
        capturedAt: body.capturedAt,
        caption: body.caption,
        createdBy: actor.userId,
      })
      return { fileId: body.fileId, receivedBytes: 0, sizeBytes: body.sizeBytes, completed: false }
    },

    async status(req, fileId, actor) {
      const upload = mongoose.isValidObjectId(fileId) ? await Upload.findOne({ fileId }).lean() : null
      if (!upload || String(upload.createdBy) !== String(actor.userId)) throw notFound('Upload not found')
      return { fileId: String(upload.fileId), receivedBytes: upload.receivedBytes, sizeBytes: upload.sizeBytes, completed: upload.status === 'completed' }
    },

    // Appends a chunk at `offset`. The offset must equal what has arrived so
    // far; otherwise the client is told how much did arrive and resends from there.
    async chunk(req, fileId, offset, buffer, actor) {
      const upload = mongoose.isValidObjectId(fileId) ? await Upload.findOne({ fileId }).lean() : null
      if (!upload || String(upload.createdBy) !== String(actor.userId)) throw notFound('Upload not found')
      if (upload.status !== 'receiving') throw conflict('upload_completed', 'This upload is already complete')
      if (offset !== upload.receivedBytes) throw new AppError(409, 'offset_mismatch', 'Resume from the received offset', { receivedBytes: upload.receivedBytes })
      if (!buffer?.length) throw badRequest('Empty chunk')
      if (upload.receivedBytes + buffer.length > upload.sizeBytes) throw badRequest('More data than the declared size')
      // Claim the range first, so two concurrent sends of the same chunk cannot both append.
      const claimed = await Upload.findOneAndUpdate({ _id: upload._id, receivedBytes: offset }, { $inc: { receivedBytes: buffer.length } }, { returnDocument: 'after' }).lean()
      if (!claimed) {
        const now = await Upload.findById(upload._id).lean()
        throw new AppError(409, 'offset_mismatch', 'Resume from the received offset', { receivedBytes: now.receivedBytes })
      }
      try {
        await storage.append(upload.tempKey, buffer)
      } catch (err) {
        await Upload.updateOne({ _id: upload._id }, { $inc: { receivedBytes: -buffer.length } })
        throw err
      }
      return { fileId: String(upload.fileId), receivedBytes: claimed.receivedBytes, sizeBytes: upload.sizeBytes }
    },

    // Checks size, SHA-256 and the real content type, makes the thumbnail and
    // creates the File (with the client's id, which offline edits already reference).
    async complete(req, fileId, actor) {
      const upload = mongoose.isValidObjectId(fileId) ? await Upload.findOne({ fileId }).lean() : null
      if (!upload || String(upload.createdBy) !== String(actor.userId)) throw notFound('Upload not found')
      if (upload.status === 'completed') return toFileView(await File.findById(fileId).lean())
      if (upload.receivedBytes !== upload.sizeBytes) throw new AppError(409, 'incomplete', 'Not all of the file has arrived yet', { receivedBytes: upload.receivedBytes })
      const bytes = await storage.read(upload.tempKey)
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
      if (sha256 !== upload.sha256 || bytes.length !== upload.sizeBytes) {
        await storage.remove(upload.tempKey)
        await Upload.updateOne({ _id: upload._id }, { $set: { receivedBytes: 0 } })
        throw new AppError(422, 'checksum_mismatch', 'The file arrived damaged — upload it again')
      }
      const head = bytes.subarray(0, 64)
      const sniffed = sniffKind(head) ?? (looksLikeCsv(bytes.subarray(0, 4096), upload.declaredMimeType, upload.fileName) ? { kind: 'sheet', mimeType: 'text/csv' } : null)
      if (!sniffed || !CATEGORY_KINDS[upload.category].includes(sniffed.kind)) {
        await storage.remove(upload.tempKey)
        await Upload.deleteOne({ _id: upload._id })
        throw new AppError(415, 'unsupported_type', 'This file is not an accepted type (photos: JPG, PNG, HEIC, WebP; PDF; Excel or CSV)')
      }
      if (bytes.length > limitBytesFor(sniffed.kind, (await Organisation.findById(req.org.id, { 'settings.uploadLimitsMb': 1 }).lean())?.settings?.uploadLimitsMb)) {
        await storage.remove(upload.tempKey)
        await Upload.deleteOne({ _id: upload._id })
        throw tooLarge('Too large for this type of file')
      }

      const storageKey = `files/${req.project.id}/${fileId}`
      let thumbnailKey = null
      let widthPx = null
      let heightPx = null
      if (sniffed.kind === 'photo') {
        try {
          const image = sharp(bytes, { failOn: 'error' }).rotate()
          const meta = await image.metadata()
          widthPx = meta.width ?? null
          heightPx = meta.height ?? null
          const thumb = await image.resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()
          thumbnailKey = `thumbs/${req.project.id}/${fileId}`
          await storage.put(thumbnailKey, thumb)
        } catch {
          // A format the image library cannot decode here (e.g. some HEIC):
          // the photo is kept and shown as a file, without a thumbnail.
        }
      }
      await storage.move(upload.tempKey, storageKey)
      // File ids are chosen by the client; one already used anywhere (even in
      // another organisation) is refused, never a 500 or an overwrite.
      const file = await File.create({
        _id: oid(fileId),
        buildingId: upload.buildingId,
        attachedTo: upload.attachedTo,
        category: upload.category,
        fileName: upload.fileName,
        storageKey,
        thumbnailKey,
        mimeType: sniffed.mimeType,
        sizeBytes: bytes.length,
        sha256,
        widthPx,
        heightPx,
        capturedAt: upload.capturedAt,
        capturedBy: actor.userId,
        caption: upload.caption,
        uploadedBy: actor.userId,
      }).catch(async (err) => {
        if (err.code !== 11000) throw err
        await Promise.all([storage.remove(storageKey), thumbnailKey ? storage.remove(thumbnailKey) : null, Upload.deleteOne({ _id: upload._id })])
        throw conflict('upload_exists', 'A file with this id already exists — upload it again')
      })
      await Upload.updateOne({ _id: upload._id }, { $set: { status: 'completed' } })
      await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: upload.buildingId, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: 'file.uploaded', objectType: 'File', objectId: file._id, changeType: 'design_intent', source: 'ui', comment: `${upload.fileName} (${upload.category})` })
      return toFileView(file.toObject())
    },

    async list(req, attachedTo) {
      const resolved = await resolveAttachment(req, attachedTo)
      const files = await File.find({ 'attachedTo.type': resolved.attachedTo.type, 'attachedTo.id': resolved.attachedTo.id, deletedAt: null }).sort({ sortOrder: 1, uploadedAt: 1 }).lean()
      return files.map(toFileView)
    },

    async meta(req, fileId) {
      return toFileView(await readable(req, fileId))
    },

    async open(req, fileId, { thumbnail = false } = {}) {
      const file = await readable(req, fileId)
      if (thumbnail && !file.thumbnailKey) throw notFound('No thumbnail for this file')
      return {
        file,
        stream: storage.stream(thumbnail ? file.thumbnailKey : file.storageKey),
        mimeType: thumbnail ? 'image/jpeg' : file.mimeType,
      }
    },

    async remove(req, fileId, actor) {
      const file = await readable(req, fileId)
      await assertWriter(req, file.attachedTo.type)
      // Survey evidence goes with the workflow: once a tab is submitted,
      // verified or imported, its photos stay until the tab is back in Draft.
      if (file.attachedTo.type === 'surveyTabRecord') {
        const record = await SurveyTabRecord.findById(file.attachedTo.id, { status: 1 }).lean()
        if (record && !['draft', 'rejected'].includes(record.status)) throw conflict('tab_locked', `This tab is ${record.status} — edit it back to Draft before removing its photos`)
      }
      await File.updateOne({ _id: file._id }, { $set: { deletedAt: new Date(), deletedBy: actor.userId } })
      await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: file.buildingId, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: 'file.deleted', objectType: 'File', objectId: file._id, changeType: 'design_intent', source: 'ui', comment: file.fileName })
      return { id: String(file._id), deleted: true }
    },
  }
}
