import sharp from 'sharp'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, TableOfContents, Header, Footer, PageNumber, AlignmentType, PageBreak, ShadingType, BorderStyle } from 'docx'
import { outline } from './util.js'

// Word, Excel, CSV, PNG and ZIP outputs (M6b).

export async function svgToPng(svg, { width = null } = {}) {
  const img = sharp(Buffer.from(svg), { density: 144 })
  return (width ? img.resize({ width, withoutEnlargement: true }) : img).png().toBuffer()
}

// Sheets [{ name, rows }] → .xlsx (first row bold via a frozen header).
export function renderXlsx(sheets) {
  const book = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    ws['!cols'] = (s.rows[0] ?? []).map((_, i) => ({ wch: Math.min(48, Math.max(8, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) }))
    XLSX.utils.book_append_sheet(book, ws, s.name.slice(0, 31))
  }
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
}

export async function renderZip(entries) {
  const zip = new JSZip()
  for (const e of entries) zip.file(e.path, e.data)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

const dataUriBytes = (uri) => (uri ? Buffer.from(uri.split(',')[1], 'base64') : null)

// The same document model as a Word file: cover, a table of contents Word
// fills when the file opens, numbered headings, tables, diagrams as images,
// page numbers in the footer. (Word has no watermark requirement.)
export async function renderDocx(doc, { branding = {}, images = new Map() } = {}) {
  const entries = outline(doc)
  const byId = new Map(entries.map((e) => [e.id, e]))
  const children = []
  const logoRun = async (uri, label) => {
    const bytes = dataUriBytes(uri)
    if (!bytes) return new TextRun({ text: `[${label}]`, color: '8A909C' })
    const png = await sharp(bytes).resize({ height: 120, withoutEnlargement: true }).png().toBuffer()
    const meta = await sharp(png).metadata()
    return new ImageRun({ type: 'png', data: png, transformation: { width: Math.round((meta.width / meta.height) * 60), height: 60 } })
  }
  children.push(new Paragraph({ children: [await logoRun(branding.organisationLogo, branding.organisationName ?? 'Organisation logo'), new TextRun({ text: '\t' }), await logoRun(branding.clientLogo, 'Client logo')] }))
  children.push(new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: doc.title, bold: true, size: 56, color: '094F9A' })] }))
  if (doc.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: doc.subtitle, size: 28, color: '5B6270' })] }))
  for (const [k, v] of [['Project', doc.meta.project], ['Client', doc.meta.client], ['Building', doc.meta.building], ['Document version', doc.meta.version], ['Date', doc.meta.date], ['Prepared by', branding.organisationName]].filter(([, v]) => v)) {
    children.push(new Paragraph({ children: [new TextRun({ text: `${k}: `, color: '5B6270' }), new TextRun({ text: String(v) })] }))
  }
  children.push(new Paragraph({ children: [new PageBreak()] }))
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] }))
  children.push(new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }))
  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'E2E5EA' }
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder }
  const tableOf = (b) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: b.columns.map((c) => new TableCell({ borders, shading: { type: ShadingType.CLEAR, fill: 'F4F5F7', color: 'auto' }, children: [new Paragraph({ children: [new TextRun({ text: c.label, bold: true, size: 16 })] })] })) }),
        ...b.rows.map((r) => new TableRow({ children: b.columns.map((c) => new TableCell({ borders, children: [new Paragraph({ children: [new TextRun({ text: String(r[c.key] ?? ''), size: 16 })] })] })) })),
      ],
    })
  async function blocks(list) {
    for (const b of list) {
      if (b.type === 'p') children.push(new Paragraph({ children: [new TextRun(b.text)] }))
      else if (b.type === 'note') children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: 'F4F5F7', color: 'auto' }, children: [new TextRun({ text: b.text, italics: true })] }))
      else if (b.type === 'list') b.items.forEach((i) => children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(i)] })))
      else if (b.type === 'kv') b.rows.forEach(([k, v]) => children.push(new Paragraph({ children: [new TextRun({ text: `${k}: `, color: '5B6270' }), new TextRun(String(v))] })))
      else if (b.type === 'table') children.push(b.rows.length ? tableOf(b) : new Paragraph({ children: [new TextRun({ text: b.empty ?? 'None.', color: '5B6270' })] }))
      else if (b.type === 'svg') {
        const png = await svgToPng(b.svg, { width: 1400 })
        const meta = await sharp(png).metadata()
        const w = Math.min(600, meta.width)
        children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: w, height: Math.round((meta.height / meta.width) * w) } })] }))
        if (b.caption) children.push(new Paragraph({ children: [new TextRun({ text: b.caption, size: 16, color: '5B6270' })] }))
      } else if (b.type === 'image') {
        const bytes = dataUriBytes(images.get(b.fileId))
        if (bytes) {
          const meta = await sharp(bytes).metadata()
          const w = Math.min(450, meta.width ?? 450)
          children.push(new Paragraph({ children: [new ImageRun({ type: 'jpg', data: bytes, transformation: { width: w, height: Math.round(((meta.height ?? 1) / (meta.width ?? 1)) * w) } })] }))
        }
      }
    }
  }
  async function sections(list, depth) {
    for (const s of list) {
      const e = byId.get(s.id)
      if (depth === 0) children.push(new Paragraph({ children: [new PageBreak()] }))
      children.push(new Paragraph({ heading: depth === 0 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, children: [new TextRun(`${e.n} ${s.title}`)] }))
      await blocks(s.blocks)
      await sections(s.children ?? [], depth + 1)
    }
  }
  await sections(doc.sections, 0)
  const file = new Document({
    creator: branding.organisationName ?? 'Rackium',
    title: doc.title,
    features: { updateFields: true },
    styles: { default: { document: { run: { font: 'Arial', size: 19 } } }, paragraphStyles: [{ id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { size: 30, bold: true, color: '094F9A' }, paragraph: { spacing: { before: 240, after: 120 } } }, { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { size: 24, bold: true }, paragraph: { spacing: { before: 200, after: 80 } } }] },
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${doc.meta.building ?? ''} · ${doc.title}`, size: 14, color: '5B6270' })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 14, color: '5B6270' })] })] }) },
        children,
      },
    ],
  })
  return Packer.toBuffer(file)
}
