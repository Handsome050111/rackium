import mongoose from 'mongoose'
import sharp from 'sharp'
import { HELP_PART_KEYS, HELP_PHOTOS_MAX, HELP_PHOTO_MAX_BYTES, SURVEY_HELP_FIELDS, isHelpKey, mergedHelp, plainText } from '@rackium/shared/fieldHelp.js'
import { FieldHelp } from '../models/fieldHelp.js'
import { Organisation } from '../models/organisation.js'
import { sniffKind, limitBytesFor } from '../files/sniff.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, badRequest, conflict, notFound } from '../http/errors.js'

const tooLarge = (message) => new AppError(413, 'too_large', message)

// Field help (DATA-MODEL §5.16; M7a-2): the platform defaults (survey hints,
// placeholders) under the organisation's own text and reference photos. Text
// is plain text; photos are decoded and re-encoded, so no metadata (EXIF,
// GPS) survives, and are stored through the same file storage as uploads.

const PHOTO_PX = 1600
// Re-encoded in the format received; HEIC is refused (it cannot be decoded here everywhere).
const OUTPUT = { 'image/jpeg': (img) => img.jpeg({ quality: 85 }), 'image/png': (img) => img.png(), 'image/webp': (img) => img.webp({ quality: 85 }) }

const photoView = (orgId) => (p) => ({ id: String(p.id), url: `/api/v1/orgs/${orgId}/field-help/photos/${p.id}`, mimeType: p.mimeType, sizeBytes: p.sizeBytes, widthPx: p.widthPx, heightPx: p.heightPx, caption: p.caption ?? null })
const overrideOf = (row, orgId) => (row ? { ...Object.fromEntries(HELP_PART_KEYS.map((k) => [k, row[k] ?? null])), photos: (row.photos ?? []).map(photoView(orgId)) } : null)

function requireKey(key) {
  if (!isHelpKey(key)) throw notFound('No such field')
}

export function createFieldHelpService({ storage }) {
  async function audit(req, actor, action, key, { changes = [], comment = null } = {}) {
    await recordAudit({ organisationId: req.org.id, projectId: null, actor: userActor(actor.userId, actor.role), action, objectType: 'FieldHelp', objectId: key, changeType: 'design_intent', source: 'ui', comment, changes })
  }

  return {
    // Every field under a prefix with its help (null: no help yet), plus the field list.
    async list(req, { prefix = 'survey:' } = {}) {
      const fields = SURVEY_HELP_FIELDS.filter((f) => f.key.startsWith(prefix))
      const rows = new Map((await FieldHelp.find({ key: { $in: fields.map((f) => f.key) } }).lean()).map((r) => [r.key, r]))
      return {
        fields: fields.map((f) => ({ key: f.key, tab: f.tab, section: f.section, label: f.label, help: mergedHelp(f.key, overrideOf(rows.get(f.key), req.org.id)), own: overrideOf(rows.get(f.key), req.org.id) })),
      }
    },

    async update(req, key, body, actor) {
      requireKey(key)
      const before = (await FieldHelp.findOne({ key }).lean()) ?? {}
      const set = {}
      const changes = []
      for (const k of HELP_PART_KEYS) {
        if (body[k] === undefined) continue
        const value = plainText(body[k])
        set[k] = value
        if ((before[k] ?? null) !== value) changes.push({ objectType: 'FieldHelp', objectId: key, field: k, before: before[k] ?? null, after: value })
      }
      await FieldHelp.updateOne({ key }, { $set: { ...set, updatedBy: actor.userId, updatedAt: new Date() }, $setOnInsert: { photos: [] } }, { upsert: true })
      if (changes.length) await audit(req, actor, 'field_help.updated', key, { changes })
      return this.one(req, key)
    },

    async one(req, key) {
      requireKey(key)
      const row = await FieldHelp.findOne({ key }).lean()
      return { key, help: mergedHelp(key, overrideOf(row, req.org.id)), own: overrideOf(row, req.org.id) }
    },

    // Back to the platform default text (photos stay until removed).
    async reset(req, key, actor) {
      requireKey(key)
      const before = await FieldHelp.findOne({ key }).lean()
      if (before) {
        await FieldHelp.updateOne({ key }, { $set: { ...Object.fromEntries(HELP_PART_KEYS.map((k) => [k, null])), updatedBy: actor.userId, updatedAt: new Date() } })
        const changes = HELP_PART_KEYS.filter((k) => before[k]).map((k) => ({ objectType: 'FieldHelp', objectId: key, field: k, before: before[k], after: null }))
        if (changes.length) await audit(req, actor, 'field_help.reset', key, { changes })
      }
      return this.one(req, key)
    },

    async addPhoto(req, key, bytes, { caption = null } = {}, actor) {
      requireKey(key)
      if (!Buffer.isBuffer(bytes) || !bytes.length) throw badRequest('Send the photo as the request body')
      const existing = await FieldHelp.findOne({ key }, { photos: 1 }).lean()
      if ((existing?.photos?.length ?? 0) >= HELP_PHOTOS_MAX) throw conflict('too_many_photos', `A field has at most ${HELP_PHOTOS_MAX} reference photos`)
      const sniffed = sniffKind(bytes.subarray(0, 64))
      if (!sniffed || sniffed.kind !== 'photo' || !OUTPUT[sniffed.mimeType]) throw new AppError(415, 'unsupported_type', 'A reference photo is a JPG, PNG or WebP image')
      const org = await Organisation.findById(req.org.id, { 'settings.uploadLimitsMb': 1 }).lean()
      if (bytes.length > Math.min(limitBytesFor('photo', org?.settings?.uploadLimitsMb), HELP_PHOTO_MAX_BYTES)) throw tooLarge('This photo is too large')
      let out
      try {
        // rotate() applies the EXIF orientation; the encoder writes no metadata.
        const encoded = await OUTPUT[sniffed.mimeType](sharp(bytes, { failOn: 'error' }).rotate().resize(PHOTO_PX, PHOTO_PX, { fit: 'inside', withoutEnlargement: true })).toBuffer({ resolveWithObject: true })
        out = encoded
      } catch {
        throw new AppError(415, 'unsupported_type', 'This image could not be read')
      }
      const photoId = new mongoose.Types.ObjectId()
      const storageKey = `help/${req.org.id}/${photoId}`
      await storage.put(storageKey, out.data)
      const photo = { id: photoId, storageKey, mimeType: sniffed.mimeType, sizeBytes: out.data.length, widthPx: out.info.width, heightPx: out.info.height, caption: plainText(caption, 200), uploadedBy: actor.userId, uploadedAt: new Date() }
      const res = await FieldHelp.updateOne({ key, [`photos.${HELP_PHOTOS_MAX - 1}`]: { $exists: false } }, { $push: { photos: photo }, $set: { updatedBy: actor.userId, updatedAt: new Date() } }, { upsert: true }).catch(async (err) => {
        await storage.remove(storageKey)
        if (err.code === 11000) throw conflict('too_many_photos', `A field has at most ${HELP_PHOTOS_MAX} reference photos`)
        throw err
      })
      if (!res.modifiedCount && !res.upsertedCount) {
        await storage.remove(storageKey)
        throw conflict('too_many_photos', `A field has at most ${HELP_PHOTOS_MAX} reference photos`)
      }
      await audit(req, actor, 'field_help.photo_added', key, { comment: `${photo.widthPx}×${photo.heightPx} ${photo.mimeType}` })
      return { photo: photoView(req.org.id)(photo) }
    },

    async removePhoto(req, key, photoId, actor) {
      requireKey(key)
      if (!mongoose.isValidObjectId(photoId)) throw notFound('Photo not found')
      const row = await FieldHelp.findOne({ key, 'photos.id': new mongoose.Types.ObjectId(photoId) }, { photos: 1 }).lean()
      const photo = row?.photos.find((p) => String(p.id) === photoId)
      if (!photo) throw notFound('Photo not found')
      await FieldHelp.updateOne({ _id: row._id }, { $pull: { photos: { id: photo.id } }, $set: { updatedBy: actor.userId, updatedAt: new Date() } })
      await storage.remove(photo.storageKey)
      await audit(req, actor, 'field_help.photo_removed', key)
      return { removed: photoId }
    },

    // A reference photo for any member of the organisation.
    async photo(req, photoId) {
      if (!mongoose.isValidObjectId(photoId)) throw notFound('Photo not found')
      const row = await FieldHelp.findOne({ 'photos.id': new mongoose.Types.ObjectId(photoId) }, { photos: 1 }).lean()
      const photo = row?.photos.find((p) => String(p.id) === photoId)
      if (!photo) throw notFound('Photo not found')
      return { bytes: await storage.read(photo.storageKey), mimeType: photo.mimeType }
    },
  }
}
