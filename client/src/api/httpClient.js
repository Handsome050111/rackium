// Thin fetch wrapper for the real API. Cookies are sent on every request (the
// session lives in httpOnly cookies), and every error arrives in the one
// format the server uses: { error: { code, message, details } }.
import { getViewAsSession } from '../lib/viewAsSession.js'

export const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function apiRequest(path, { method = 'GET', body } = {}) {
  const init = { method, credentials: 'include', headers: {} }
  const viewAs = getViewAsSession()
  if (viewAs) init.headers['X-View-As-Session'] = viewAs.id
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.')
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data?.error
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? 'Something went wrong', err?.details)
  }
  return data
}
