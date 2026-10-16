import { outline, escapeHtml } from './util.js'
import { INTERNAL_COST_MARK } from '@rackium/shared/documents/types.js'

// The default document template (M6b) until Technonex supplies a branding
// template: Rackium design tokens, a cover page with the organisation's and
// the client's logo (a placeholder when there is none), a table of contents,
// numbered sections and a diagonal watermark on every page (v2.2 §11.8).
// Pass 1 adds an invisible marker before each heading; the PDF renderer reads
// which page each marker landed on and pass 2 prints those page numbers.

const TOKENS = { brand: '#094F9A', text: '#1F2430', secondary: '#5B6270', border: '#E2E5EA', muted: '#F4F5F7', amber: '#B26A00', green: '#2E9E5B', red: '#ED1A4C' }
export const marker = (id) => `§${id}§`

const css = `
@page { size: A4; margin: 22mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: ${TOKENS.text}; line-height: 1.4; }
.cover { height: 250mm; display: flex; flex-direction: column; page-break-after: always; }
.logos { display: flex; justify-content: space-between; align-items: center; height: 22mm; }
.logos img { max-height: 20mm; max-width: 60mm; object-fit: contain; }
.logo-placeholder { width: 50mm; height: 18mm; border: 1px dashed ${TOKENS.border}; color: ${TOKENS.secondary}; font-size: 8pt; display: flex; align-items: center; justify-content: center; }
.cover h1 { font-size: 28pt; color: ${TOKENS.brand}; margin: 60mm 0 4mm; }
.cover .subtitle { font-size: 14pt; color: ${TOKENS.secondary}; margin-bottom: 14mm; }
.cover table.meta td { padding: 1.5mm 6mm 1.5mm 0; font-size: 10pt; }
.cover table.meta td:first-child { color: ${TOKENS.secondary}; }
.cover .band { margin-top: auto; height: 6mm; background: ${TOKENS.brand}; }
.toc { page-break-after: always; }
.toc h2 { color: ${TOKENS.brand}; font-size: 16pt; }
.toc .entry { display: flex; font-size: 10pt; margin: 1.2mm 0; }
.toc .entry .t { flex: 0 1 auto; }
.toc .entry .dots { flex: 1; border-bottom: 1px dotted #8A909C; margin: 0 2mm 1.2mm; }
.toc .entry.d1 { padding-left: 6mm; font-size: 9pt; }
h1.section { color: ${TOKENS.brand}; font-size: 15pt; border-bottom: 2px solid ${TOKENS.brand}; padding-bottom: 1.5mm; page-break-before: always; margin-top: 0; }
h2.section { color: ${TOKENS.text}; font-size: 12pt; margin: 6mm 0 2mm; page-break-after: avoid; }
.mark { font-size: 1px; color: #ffffff; }
h3.sub { font-size: 10.5pt; color: ${TOKENS.text}; margin: 4mm 0 1.5mm; page-break-after: avoid; }
table.kv { border-collapse: collapse; margin: 2mm 0 4mm; }
table.kv td { padding: 1mm 6mm 1mm 0; vertical-align: top; }
table.kv td:first-child { color: ${TOKENS.secondary}; white-space: nowrap; }
table.grid { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 8pt; }
table.grid th { background: ${TOKENS.muted}; color: ${TOKENS.secondary}; text-align: left; font-weight: 600; }
table.grid th, table.grid td { border: 1px solid ${TOKENS.border}; padding: 1.2mm 1.6mm; vertical-align: top; word-break: break-word; }
table.grid tr { page-break-inside: avoid; }
thead { display: table-header-group; }
.caption { font-size: 8pt; color: ${TOKENS.secondary}; margin: 1mm 0 4mm; }
.figure { page-break-inside: avoid; margin: 3mm 0; }
.figure svg { max-width: 100%; height: auto; max-height: 220mm; }
.figure img { max-width: 100%; max-height: 110mm; border: 1px solid ${TOKENS.border}; }
.note { border-left: 3px solid ${TOKENS.brand}; background: ${TOKENS.muted}; padding: 2mm 3mm; margin: 2mm 0; }
.note.warning { border-color: ${TOKENS.amber}; }
.note.success { border-color: ${TOKENS.green}; }
.internal { margin-top: 10mm; display: inline-block; border: 2px solid ${TOKENS.red}; color: ${TOKENS.red}; font-weight: 700; padding: 2mm 4mm; }
.watermark { position: fixed; top: 40%; left: -10%; width: 120%; text-align: center; transform: rotate(-32deg); font-size: 30pt; color: ${TOKENS.brand}; opacity: 0.09; white-space: nowrap; z-index: 1000; pointer-events: none; }
`

function block(b, images) {
  switch (b.type) {
    case 'p':
      return `<p>${escapeHtml(b.text)}</p>`
    case 'h3':
      return `<h3 class="sub">${escapeHtml(b.text)}</h3>`
    case 'note':
      return `<div class="note ${escapeHtml(b.tone ?? '')}">${escapeHtml(b.text)}</div>`
    case 'kv':
      return `<table class="kv">${b.rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`
    case 'list':
      return `<ul>${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    case 'table':
      if (!b.rows.length) return `<p class="caption">${escapeHtml(b.empty ?? 'None.')}</p>`
      return `<table class="grid"><thead><tr>${b.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${b.columns.map((c) => `<td>${escapeHtml(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>${b.caption ? `<div class="caption">${escapeHtml(b.caption)}</div>` : ''}`
    case 'svg':
      return `<div class="figure">${b.svg}${b.caption ? `<div class="caption">${escapeHtml(b.caption)}</div>` : ''}</div>`
    case 'image': {
      const src = images.get(b.fileId)
      return src ? `<div class="figure"><img src="${src}" alt="${escapeHtml(b.caption ?? '')}"/>${b.caption ? `<div class="caption">${escapeHtml(b.caption)}</div>` : ''}</div>` : `<p class="caption">${escapeHtml(b.caption ?? 'Photo')} (not available)</p>`
    }
    case 'pagebreak':
      return '<div style="page-break-after: always"></div>'
    default:
      return ''
  }
}

// `pages`: section id → page number (pass 2), or null (pass 1, markers).
export function documentHtml(doc, { branding = {}, watermark = null, images = new Map(), pages = null }) {
  const entries = outline(doc)
  const logo = (src, label) => (src ? `<img src="${src}" alt="${escapeHtml(label)}"/>` : `<div class="logo-placeholder">${escapeHtml(label)}</div>`)
  const meta = [
    ['Project', doc.meta.project],
    ['Client', doc.meta.client],
    ['Building', doc.meta.building],
    ['Document version', doc.meta.version],
    ['Date', doc.meta.date],
    ['Prepared by', branding.organisationName],
  ].filter(([, v]) => v)
  const cover = `<section class="cover"><div class="logos">${logo(branding.organisationLogo, branding.organisationName ?? 'Organisation logo')}${logo(branding.clientLogo, 'Client logo')}</div>${doc.internal ? `<div class="internal">${escapeHtml(INTERNAL_COST_MARK)} — not for the client</div>` : ''}<h1>${escapeHtml(doc.title)}</h1><div class="subtitle">${escapeHtml(doc.subtitle ?? '')}</div><table class="meta">${meta.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table><div class="band"></div></section>`
  const toc = `<section class="toc"><h2>Contents</h2>${entries.map((e) => `<div class="entry d${Math.min(e.depth, 1)}"><span class="t">${escapeHtml(e.n)} ${escapeHtml(e.title)}</span><span class="dots"></span><span>${pages ? pages.get(e.id) ?? '' : '00'}</span></div>`).join('')}</section>`
  const byId = new Map(entries.map((e) => [e.id, e]))
  const render = (sections, depth) =>
    sections
      .map((s) => {
        const e = byId.get(s.id)
        const tag = depth === 0 ? 'h1' : 'h2'
        return `<${tag} class="section">${pages ? '' : `<span class="mark">${marker(s.id)}</span>`}${escapeHtml(e.n)} ${escapeHtml(s.title)}</${tag}>${s.blocks.map((b) => block(b, images)).join('')}${render(s.children ?? [], depth + 1)}`
      })
      .join('')
  const wmText = [doc.internal ? INTERNAL_COST_MARK : null, watermark ? [watermark.organisation, watermark.date, watermark.user].filter(Boolean).join(' · ') : null].filter(Boolean)
  const wm = wmText.length ? `<div class="watermark">${wmText.map(escapeHtml).join('<br/>')}</div>` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>${css}</style></head><body>${wm}${cover}${toc}${render(doc.sections, 0)}</body></html>`
}

// Header and footer on every page but the cover (Chromium's print templates).
export function headerFooter(doc, { branding = {} }) {
  const small = 'font-family: Arial, sans-serif; font-size: 7.5pt; color: #5B6270; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;'
  return {
    headerTemplate: `<div style="${small}"><span>${escapeHtml([doc.meta.project, doc.meta.building].filter(Boolean).join(' · '))}</span>${doc.internal ? `<span style="color:#ED1A4C;font-weight:700">${escapeHtml(INTERNAL_COST_MARK)}</span>` : ''}<span>${escapeHtml(doc.title)}${doc.meta.version ? ` · ${escapeHtml(doc.meta.version)}` : ''}</span></div>`,
    footerTemplate: `<div style="${small}"><span>${escapeHtml(branding.organisationName ?? '')}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  }
}
