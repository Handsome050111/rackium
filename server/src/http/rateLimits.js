import rateLimit from 'express-rate-limit'

// Auth routes are the brute-force surface. Limits are per client IP and are
// disabled entirely in tests that pass enabled: false.
export function authLimiter({ enabled, windowMs, limit, message }) {
  if (!enabled) return (req, res, next) => next()
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message } },
  })
}
