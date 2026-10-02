// Mock client-approval share link (brief Step 7: "PM generates a share
// link (mock) with password and expiry, default 14 days, 1-30 allowed").
// Entirely in-memory — no real security, this is a prototype.

const links = {} // token -> { token, buildingId, password, createdAt, expiresAt, revoked }
const decisions = {} // token -> { decision, name, role, comments, acceptedAt, hasSignature }

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function randomToken() {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('')
}

export const MIN_EXPIRY_DAYS = 1
export const MAX_EXPIRY_DAYS = 30
export const DEFAULT_EXPIRY_DAYS = 14

// `kind` tells the public approval page (and this module's own callers)
// what's being approved — 'solution-package' (default, Step 7) or
// 'handover' (Step 9) — so one share-link mechanism and one public page
// serve both instead of duplicating either (brief Step 9: "reuses the Step
// 7 share-link mechanism and the public approval page component").
export async function generateShareLink(buildingId, { password, expiryDays = DEFAULT_EXPIRY_DAYS, kind = 'solution-package' } = {}) {
  const clampedDays = Math.min(MAX_EXPIRY_DAYS, Math.max(MIN_EXPIRY_DAYS, Number(expiryDays) || DEFAULT_EXPIRY_DAYS))
  const token = randomToken()
  const record = {
    token,
    buildingId,
    kind,
    password: password || Math.random().toString(36).slice(2, 8).toUpperCase(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + clampedDays * 24 * 60 * 60 * 1000).toISOString(),
    revoked: false,
  }
  links[token] = record
  return resolveAfter({ ...record })
}

export async function getActiveShareLink(buildingId, kind = 'solution-package') {
  const active = Object.values(links)
    .filter((l) => l.buildingId === buildingId && l.kind === kind && !l.revoked)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
  return resolveAfter(active ? { ...active } : null)
}

function linkStatus(link) {
  if (!link) return 'not-found'
  if (link.revoked) return 'revoked'
  if (new Date(link.expiresAt) < new Date()) return 'expired'
  return 'active'
}

export async function getShareLinkInfo(token) {
  const link = links[token]
  return resolveAfter({ status: linkStatus(link), buildingId: link?.buildingId ?? null, kind: link?.kind ?? null })
}

export async function checkSharePassword(token, password) {
  const link = links[token]
  if (linkStatus(link) !== 'active') return resolveAfter({ ok: false, status: linkStatus(link) })
  return resolveAfter({ ok: link.password === password, status: 'active' })
}

export async function recordClientDecision(token, { decision, name, role, comments, acceptedTerms, hasSignature }) {
  const link = links[token]
  if (linkStatus(link) !== 'active') return resolveAfter({ ok: false, error: 'This approval link is no longer active.' })
  if (!name?.trim() || !acceptedTerms) return resolveAfter({ ok: false, error: 'Name and the acceptance checkbox are required.' })

  const record = { decision, name, role, comments: comments ?? '', acceptedAt: new Date().toISOString(), hasSignature: Boolean(hasSignature) }
  decisions[token] = record
  return resolveAfter({ ok: true, buildingId: link.buildingId, ...record })
}

export async function getClientDecision(token) {
  return resolveAfter(decisions[token] ? { ...decisions[token] } : null)
}
