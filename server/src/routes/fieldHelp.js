import express from 'express'
import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireAction, actorOf } from '../http/middleware.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)
// The photo is the request body (its bytes are checked, not the declared type).
const photoBody = express.raw({ type: () => true, limit: '11mb' })

// M7a-2 (brief v2.2 §18, v2.3 §4.3): field help — every organisation member
// reads it; the Org Admin edits the text and the reference photos.
export function fieldHelpRoutes({ config, fieldHelp }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg()]
  const admin = requireAction(ACTIONS.MANAGE_TOOLTIPS)

  r.get('/field-help', ...base, validate({ query: C.fieldHelpListQuery }), async (req, res) => {
    res.json(await fieldHelp.list(req, req.input.query))
  })
  r.get('/field-help/photos/:photoId', ...base, validate({ params: z.object({ photoId: hex }) }), async (req, res) => {
    const { bytes, mimeType } = await fieldHelp.photo(req, req.input.params.photoId)
    res.set('Content-Type', mimeType)
    res.set('Cache-Control', 'private, max-age=3600')
    res.set('X-Content-Type-Options', 'nosniff')
    res.send(bytes)
  })
  r.put('/field-help/:key', ...base, admin, validate({ params: C.fieldHelpKeyParam, body: C.fieldHelpBody }), async (req, res) => {
    res.json(await fieldHelp.update(req, req.input.params.key, req.input.body, actorOf(req)))
  })
  r.delete('/field-help/:key', ...base, admin, validate({ params: C.fieldHelpKeyParam }), async (req, res) => {
    res.json(await fieldHelp.reset(req, req.input.params.key, actorOf(req)))
  })
  r.post('/field-help/:key/photos', ...base, admin, photoBody, validate({ params: C.fieldHelpKeyParam, query: z.object({ caption: z.string().max(200).optional() }) }), async (req, res) => {
    res.status(201).json(await fieldHelp.addPhoto(req, req.input.params.key, req.body, { caption: req.input.query.caption ?? null }, actorOf(req)))
  })
  r.delete('/field-help/:key/photos/:photoId', ...base, admin, validate({ params: C.fieldHelpKeyParam.extend({ photoId: hex }) }), async (req, res) => {
    res.json(await fieldHelp.removePhoto(req, req.input.params.key, req.input.params.photoId, actorOf(req)))
  })
  return r
}
