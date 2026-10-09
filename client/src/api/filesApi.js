import { API_MODE } from '../lib/apiMode.js'
import { API_BASE, ApiError, apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}/files`
export const CHUNK_BYTES = 1024 * 1024

// Lower-case hex SHA-256 of a Blob (the server checks it on completion).
export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sendChunk(path, offset, chunk) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}?offset=${offset}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk })
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'unknown', data?.error?.message ?? 'Upload failed', data?.error?.details)
  return data
}

// Uploads (or resumes) one file under its client-chosen id. `meta` is the
// upload start body minus size/hash; `onProgress(received, total)`.
// Safe to call again after any failure: the server says how much arrived
// and the upload continues from there (DATA-MODEL §9).
export async function uploadFile(orgId, projectId, blob, meta, { onProgress, sha256 } = {}) {
  if (!real) return { id: meta.fileId }
  const hash = sha256 ?? (await sha256Hex(blob))
  const path = base(orgId, projectId)
  const started = await apiRequest(`${path}/uploads`, { method: 'POST', body: { ...meta, sizeBytes: blob.size, sha256: hash } })
  if (started.completed) return started.file
  let offset = started.receivedBytes
  onProgress?.(offset, blob.size)
  while (offset < blob.size) {
    try {
      offset = (await sendChunk(`${path}/uploads/${meta.fileId}`, offset, blob.slice(offset, offset + CHUNK_BYTES))).receivedBytes
    } catch (err) {
      // Another attempt (or a lost response) moved the offset: resume from the server's.
      if (err.code === 'offset_mismatch' && Number.isInteger(err.details?.receivedBytes)) offset = err.details.receivedBytes
      else throw err
    }
    onProgress?.(offset, blob.size)
  }
  return (await apiRequest(`${path}/uploads/${meta.fileId}/complete`, { method: 'POST' })).file
}

export const filesApi = {
  list: (o, p, attachedTo) => (real ? apiRequest(`${base(o, p)}?${new URLSearchParams(Object.entries(attachedTo).filter(([, v]) => v != null))}`) : Promise.resolve({ files: [] })),
  meta: (o, p, fileId) => (real ? apiRequest(`${base(o, p)}/${fileId}`) : Promise.resolve({ file: null })),
  remove: (o, p, fileId) => (real ? apiRequest(`${base(o, p)}/${fileId}`, { method: 'DELETE' }) : Promise.resolve(null)),
  // Authorised URLs (cookie session; same origin) — never public links.
  contentUrl: (o, p, fileId) => `${API_BASE}${base(o, p)}/${fileId}/content`,
  thumbnailUrl: (o, p, fileId) => `${API_BASE}${base(o, p)}/${fileId}/thumbnail`,
}
