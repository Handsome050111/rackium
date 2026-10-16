import { API_MODE } from '../lib/apiMode.js'
import { apiRequest, API_BASE } from './httpClient.js'

const real = API_MODE === 'real'
const base = (o, p) => `/orgs/${o}/projects/${p}`
const none = (value) => Promise.resolve(value)

// Real mode only (M6b): the document engine, labels, branding and handover.
export const documentsApi = {
  list: (o, p, { buildingId = null, typeKey = null } = {}) => (real ? apiRequest(`${base(o, p)}/documents?${new URLSearchParams(Object.entries({ buildingId, typeKey }).filter(([, v]) => v))}`) : none({ documents: [], types: [] })),
  request: (o, p, body) => (real ? apiRequest(`${base(o, p)}/documents`, { method: 'POST', body }) : none(null)),
  get: (o, p, id) => (real ? apiRequest(`${base(o, p)}/documents/${id}`) : none(null)),
  // A plain link: the browser downloads with the session cookie.
  downloadUrl: (o, p, id) => `${API_BASE}${base(o, p)}/documents/${id}/download`,
  shareLinks: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/documents/share-links?buildingId=${buildingId}`) : none({ shareLinks: [] })),
  createShareLink: (o, p, body) => (real ? apiRequest(`${base(o, p)}/documents/share-links`, { method: 'POST', body }) : none(null)),
  locate: (o, p, connectionId) => (real ? apiRequest(`${base(o, p)}/connections/${connectionId}/locate`) : none(null)),
  headings: (o, p) => (real ? apiRequest(`${base(o, p)}/settings/cable-headings`) : none(null)),
  setHeadings: (o, p, headings) => (real ? apiRequest(`${base(o, p)}/settings/cable-headings`, { method: 'PUT', body: { headings } }) : none(null)),
  clientLogoUrl: (o, p) => `${API_BASE}${base(o, p)}/settings/client-logo`,
  setClientLogo: (o, p, dataUrl) => (real ? apiRequest(`${base(o, p)}/settings/client-logo`, { method: 'PUT', body: { dataUrl } }) : none(null)),
  removeClientLogo: (o, p) => (real ? apiRequest(`${base(o, p)}/settings/client-logo`, { method: 'DELETE' }) : none(null)),
  orgLogoUrl: (o) => `${API_BASE}/orgs/${o}/settings/logo`,
  setOrgLogo: (o, dataUrl) => (real ? apiRequest(`/orgs/${o}/settings/logo`, { method: 'PUT', body: { dataUrl } }) : none(null)),
  removeOrgLogo: (o) => (real ? apiRequest(`/orgs/${o}/settings/logo`, { method: 'DELETE' }) : none(null)),
}

export const handoverApi = {
  view: (o, p, b) => (real ? apiRequest(`${base(o, p)}/handover/buildings/${b}`) : none(null)),
  compile: (o, p, b) => (real ? apiRequest(`${base(o, p)}/handover/buildings/${b}/compile`, { method: 'POST', body: {} }) : none(null)),
  retry: (o, p, b) => (real ? apiRequest(`${base(o, p)}/handover/buildings/${b}/retry`, { method: 'POST', body: {} }) : none(null)),
  review: (o, p, b) => (real ? apiRequest(`${base(o, p)}/handover/buildings/${b}/review`, { method: 'POST', body: {} }) : none(null)),
  deliver: (o, p, b, body) => (real ? apiRequest(`${base(o, p)}/handover/buildings/${b}/deliver`, { method: 'POST', body }) : none(null)),
}

// The public link pages: a document as a file (POST keeps the password out of URLs).
export async function publicDownload(token, documentId, password, fileName) {
  const res = await fetch(`${API_BASE}/public/share-links/${encodeURIComponent(token)}/documents/${documentId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password ?? '' }) })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const err = new Error(data?.error?.message ?? `Download failed (${res.status})`)
    err.status = res.status
    throw err
  }
  saveBlob(await res.blob(), fileName)
}

export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// A PNG or JPEG file as a data URL (logos).
export const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

export const FORMAT_LABEL = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV', json: 'JSON', zip: 'ZIP', svg: 'SVG', png: 'PNG' }
export const isDone = (d) => d && ['ready', 'failed'].includes(d.status)
export const humanSize = (bytes) => (bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
