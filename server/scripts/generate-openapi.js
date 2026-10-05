import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOpenApiDocument } from '../src/openapi/document.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = path.join(here, '..', 'openapi', 'openapi.json')
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, JSON.stringify(buildOpenApiDocument({ version: '0.1.0' }), null, 2) + '\n')
console.log(`wrote ${path.relative(process.cwd(), target)}`)
