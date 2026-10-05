import pino from 'pino'

const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.RESEND_API_KEY',
  '*.JWT_SECRET',
]

export function createLogger({ level = 'info', pretty = false } = {}) {
  const transport = pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined
  return pino({ level, redact: { paths: REDACT, censor: '[redacted]' }, transport })
}
