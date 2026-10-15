import { chromium } from 'playwright-core'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { documentHtml, headerFooter, marker } from './html.js'
import { outline } from './util.js'

// PDFs from HTML templates in headless Chromium (M6b). One browser per
// process, launched on first use (CHROMIUM_PATH points at a system Chromium
// on a server without Playwright's download), one page per document.
let browserPromise = null
let executablePath = null
export function configurePdf({ chromiumPath = null } = {}) {
  executablePath = chromiumPath || null
}
async function browser() {
  browserPromise ??= chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }).catch((err) => {
    browserPromise = null
    throw new Error(`Cannot start Chromium for PDF generation: ${err.message.split('\n')[0]}`)
  })
  return browserPromise
}
export async function closePdfBrowser() {
  const b = browserPromise
  browserPromise = null
  if (b) await (await b).close().catch(() => {})
}

// The text of each page (PDF text extraction) — the table of contents pass
// and the tests read it.
export async function pdfPages(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    pages.push(content.items.map((x) => x.str).join(' '))
  }
  await doc.destroy()
  return pages
}

async function print(html, options) {
  const page = await (await browser()).newPage()
  try {
    await page.setContent(html, { waitUntil: 'load' })
    return await page.pdf(options)
  } finally {
    await page.close()
  }
}

// Two passes: the first finds the page of every section heading (by its
// invisible marker), the second prints the contents with those numbers.
export async function renderPdf(doc, { branding = {}, watermark = null, images = new Map(), onStep = () => {} } = {}) {
  const { headerTemplate, footerTemplate } = headerFooter(doc, { branding })
  const options = { format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate, footerTemplate, margin: { top: '22mm', bottom: '20mm', left: '16mm', right: '16mm' } }
  onStep('Laying out pages')
  const first = await print(documentHtml(doc, { branding, watermark, images, pages: null }), options)
  const text = await pdfPages(first)
  const pages = new Map()
  for (const e of outline(doc)) {
    const at = text.findIndex((t) => t.includes(marker(e.id)))
    if (at >= 0) pages.set(e.id, at + 1)
  }
  onStep('Writing the table of contents')
  const finalHtml = documentHtml(doc, { branding, watermark, images, pages })
  const pdf = await print(finalHtml, options)
  return { buffer: pdf, pageCount: text.length }
}

// A label sheet: absolute-positioned labels on pages of the stock's size.
export async function renderLabelsPdf({ size, placed, qr }) {
  const pagesCount = Math.max(1, ...placed.map((x) => x.page + 1))
  const label = ({ x, y, label: l }) => {
    const small = size.height < 30
    return `<div class="label" style="left:${x}mm;top:${y}mm;width:${size.width}mm;height:${size.height}mm"><div class="qr">${qr.get(l.connectionId)}</div><div class="txt"><div class="id">${esc(l.cableId)}</div><div class="end">${small ? '' : 'This end: '}${esc(l.here)}</div><div class="far">→ ${esc(l.far)}</div></div></div>`
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${size.page.width}mm ${size.page.height}mm; margin: 0; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
.page { position: relative; width: ${size.page.width}mm; height: ${size.page.height}mm; page-break-after: always; overflow: hidden; }
.label { position: absolute; display: flex; gap: 1.2mm; padding: 1mm; box-sizing: border-box; overflow: hidden; }
.qr { flex: 0 0 auto; height: 100%; aspect-ratio: 1; }
.qr svg { width: 100%; height: 100%; }
.txt { min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.id { font-weight: 700; font-size: ${size.height < 30 ? 8 : 11}pt; }
.end, .far { font-size: ${size.height < 30 ? 5.5 : 7}pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head><body>${Array.from({ length: pagesCount }, (_, p) => `<div class="page">${placed.filter((x) => x.page === p).map(label).join('')}</div>`).join('')}</body></html>`
  return print(html, { width: `${size.page.width}mm`, height: `${size.page.height}mm`, printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } })
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
