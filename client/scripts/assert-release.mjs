// A release build must not be able to run in mock mode (docs/DEPLOY-DEMO.md):
// it fails the deploy when the prototype's screens or test hooks are in the
// bundle, or when no real-mode code is. Run after `vite build --mode release`.
//   node scripts/assert-release.mjs [outDir]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '..', process.argv[2] ?? 'dist')

// Text only the mock mode has.
const FORBIDDEN = ['__rackiumTestApi', 'This page does not exist in the prototype', 'A recommended click-through of the whole lifecycle']
// Text a real-mode build always has: the check is reading the right files.
const REQUIRED = ['/client-config']

const assets = path.join(outDir, 'assets')
const files = fs.readdirSync(assets).filter((f) => f.endsWith('.js'))
const code = files.map((f) => [f, fs.readFileSync(path.join(assets, f), 'utf8')])
const problems = []
for (const text of FORBIDDEN) {
  const found = code.filter(([, src]) => src.includes(text)).map(([f]) => f)
  if (found.length) problems.push(`"${text}" is in ${found.join(', ')}`)
}
for (const text of REQUIRED) if (!code.some(([, src]) => src.includes(text))) problems.push(`"${text}" is in no file: this is not a real-mode build`)
if (fs.readdirSync(assets).some((f) => f.endsWith('.map'))) problems.push('source maps are in the build')

if (problems.length) {
  console.error(`Not a release build (${outDir}):\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`Release build checked: ${files.length} script(s), real mode only.`)
