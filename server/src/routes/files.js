import express from 'express'
import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { uploadStartBody, fileAttachment } from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, applyViewAs, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)
const fileParam = z.object({ fileId: hex })
const offsetQuery = z.object({ offset: z.coerce.number().int().min(0) })
const CHUNK_LIMIT = '2mb'

const loadRoles = async (req, res, next) => {
  if (!req.viewAsActive) req.roles = (await rolesIn(req.user._id, req.org.id, req.project.id)).roles
  next()
}

// "Inline" only for images; everything else downloads. The name is reduced
// to safe characters so it cannot break the header.
function disposition(file) {
  const safe = file.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file'
  return `${file.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${safe}"`
}

// /orgs/:orgId/projects/:projectId/files (DATA-MODEL §9). Uploads are
// chunked and resumable; downloads only through these authorised routes,
// with the project, organisation and the caller's building scope checked on
// every request — there are no public URLs.
export function fileRoutes({ config, files }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]

  r.post('/uploads', ...base, validate({ body: uploadStartBody }), async (req, res) => {
    res.status(201).json(await files.start(req, req.input.body, actorOf(req)))
  })
  r.get('/uploads/:fileId', ...base, validate({ params: fileParam }), async (req, res) => {
    res.json(await files.status(req, req.input.params.fileId, actorOf(req)))
  })
  r.patch(
    '/uploads/:fileId',
    ...base,
    express.raw({ type: 'application/octet-stream', limit: CHUNK_LIMIT }),
    validate({ params: fileParam, query: offsetQuery }),
    async (req, res) => {
      res.json(await files.chunk(req, req.input.params.fileId, req.input.query.offset, Buffer.isBuffer(req.body) ? req.body : null, actorOf(req)))
    }
  )
  r.post('/uploads/:fileId/complete', ...base, validate({ params: fileParam }), async (req, res) => {
    res.status(201).json({ file: await files.complete(req, req.input.params.fileId, actorOf(req)) })
  })

  // List by attachment: ?type=room&id=… or ?type=surveyTab&buildingId=…&roomId=…&tab=…
  r.get('/', ...base, async (req, res, next) => {
    const parsed = fileAttachment.safeParse(req.query)
    if (!parsed.success) return next(parsed.error)
    res.json({ files: await files.list(req, parsed.data) })
  })
  r.get('/:fileId', ...base, validate({ params: fileParam }), async (req, res) => {
    res.json({ file: await files.meta(req, req.input.params.fileId) })
  })
  const send = (thumbnail) => async (req, res) => {
    const { file, stream, mimeType } = await files.open(req, req.input.params.fileId, { thumbnail })
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', disposition({ ...file, mimeType }))
    res.setHeader('Cache-Control', 'private, max-age=300')
    stream.on('error', (err) => res.destroy(err))
    stream.pipe(res)
  }
  r.get('/:fileId/content', ...base, validate({ params: fileParam }), send(false))
  r.get('/:fileId/thumbnail', ...base, validate({ params: fileParam }), send(true))
  r.delete('/:fileId', ...base, validate({ params: fileParam }), async (req, res) => {
    res.json(await files.remove(req, req.input.params.fileId, actorOf(req)))
  })

  return r
}
