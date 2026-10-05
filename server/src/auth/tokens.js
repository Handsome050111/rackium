import crypto from 'node:crypto'
import argon2 from 'argon2'
import { SignJWT, jwtVerify } from 'jose'

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_DAYS = 30
const ISSUER = 'rackium'

// Opaque tokens for email links and refresh cookies. Only the hash is stored.
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

const keyFor = (secret) => new TextEncoder().encode(secret)

// sid is the refresh-token family for this session. The server checks the
// family is still live on every request, so logout and password reset end
// access at once instead of at token expiry.
export async function signAccessToken(userId, secret, sid) {
  return new SignJWT({ typ: 'access', sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(keyFor(secret))
}

// Returns { userId, sid } or null for any token that fails verification. Callers
// treat null as signed out; the reason is not exposed to the client.
export async function verifyAccessToken(token, secret) {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), { issuer: ISSUER, algorithms: ['HS256'] })
    if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null
    return { userId: payload.sub, sid: payload.sid }
  } catch {
    return null
  }
}

// Argon2id with the library's current defaults. Password hashes are the only
// place a plain password is ever present, and only for the length of a call.
export const hashPassword = (password) => argon2.hash(password, { type: argon2.argon2id })

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}

// Used for unknown accounts so a sign-in attempt costs the same time whether or
// not the email exists.
let dummyHashPromise
export function dummyPasswordHash() {
  dummyHashPromise ??= argon2.hash(randomToken(), { type: argon2.argon2id })
  return dummyHashPromise
}
