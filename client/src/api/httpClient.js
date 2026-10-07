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
  // Only attach it to requests inside the viewed project — otherwise, once
  // the viewer navigates elsewhere without clicking Exit first, every other
  // project's reads would also 403 (the server checks the session's own
  // project, but there's no reason to send it where it cannot apply).
  if (viewAs && path.includes(`/projects/${viewAs.projectId}/`)) init.headers['X-View-As-Session'] = viewAs.id
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
