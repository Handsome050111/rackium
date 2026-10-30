import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CONF = path.join(here, '../../deploy/nginx/security-headers.conf')

// Nginx's security headers (deploy/nginx/security-headers.conf), read from that
// one file for the real-mode e2e run, so a screen the production CSP would break
// fails there. Not HSTS: that run is over plain http.
export function previewSecurityHeaders() {
  const headers = {}
  for (const [, name, value] of fs.readFileSync(CONF, 'utf8').matchAll(/^add_header\s+(\S+)\s+"([^"]*)"\s+always;/gm)) {
    if (name !== 'Strict-Transport-Security') headers[name] = value
  }
  return headers
}
