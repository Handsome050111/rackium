import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from '../auth/tokens.js'

export const ACCESS_COOKIE = 'rk_access'
export const REFRESH_COOKIE = 'rk_refresh'
export const REFRESH_COOKIE_PATH = '/api/v1/auth'

// httpOnly keeps tokens away from script. SameSite=Strict stops cross-site
// requests from carrying them, which is the CSRF defence for this API (the API
// accepts JSON only and CORS allows one origin). Secure is on in production.
function baseOptions(config) {
  return { httpOnly: true, sameSite: 'strict', secure: config.IS_PRODUCTION }
}

export function setSessionCookies(res, config, { access, refresh }) {
  res.cookie(ACCESS_COOKIE, access, { ...baseOptions(config), path: '/api/v1', maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 })
  res.cookie(REFRESH_COOKIE, refresh, { ...baseOptions(config), path: REFRESH_COOKIE_PATH, maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000 })
}

export function clearSessionCookies(res, config) {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(config), path: '/api/v1' })
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions(config), path: REFRESH_COOKIE_PATH })
}
