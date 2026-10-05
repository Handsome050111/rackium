// One error format for every route: { error: { code, message, requestId, details? } }.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message, details) => new AppError(400, 'bad_request', message, details)
export const unauthorised = (message = 'Sign in required') => new AppError(401, 'unauthorised', message)
export const forbidden = (message = 'You do not have permission for this action') => new AppError(403, 'forbidden', message)
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message)
export const conflict = (code, message) => new AppError(409, code, message)
