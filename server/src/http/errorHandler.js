import { ZodError } from 'zod'
import { AppError } from './errors.js'

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found', requestId: req.id } })
}

export function errorHandler(logger) {
  // Express requires four arguments to recognise an error handler.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return next(err)
    const requestId = req.id
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, requestId, details: err.details } })
    }
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: { code: 'validation_failed', message: 'Request is not valid', requestId, details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      })
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Body is not valid JSON', requestId } })
    }
    if (err?.code === 11000) {
      return res.status(409).json({ error: { code: 'conflict', message: 'That value is already in use', requestId } })
    }
    logger.error({ err, requestId }, 'unhandled error')
    return res.status(500).json({ error: { code: 'internal', message: 'Something went wrong', requestId } })
  }
}
