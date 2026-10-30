// Can this server make PDFs? Starts the configured browser the way the app does
// and prints one page. Run by rackium-deploy before it switches release; on
// failure, the browser's own output is above the error.
//   node server/scripts/check-pdf.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true })
process.env.DEBUG ??= 'pw:browser'

const { loadConfig } = await import('../src/config/index.js')
const { configurePdf } = await import('../src/documents/render/chromium.js')
const { checkPdfRendering, closePdfBrowser } = await import('../src/documents/render/pdf.js')

let code = 0
try {
  configurePdf({ chromiumPath: loadConfig().CHROMIUM_PATH })
  console.log(`PDF check passed: ${await checkPdfRendering()} bytes.`)
} catch (err) {
  console.error(`PDF check failed: ${err.message}`)
  code = 1
}
await closePdfBrowser().catch(() => {})
process.exit(code)
