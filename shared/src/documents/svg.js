// Diagrams for generated documents (M6b): plain SVG strings, drawn from the
// same layout as the screens (shared/hldLayout.js) so the PDF shows what the
// app shows. No browser needed — the server embeds them in the PDF's HTML,
// converts them to PNG (sharp) or ships them as files.
import { computeHldLayout, DEVICE_WIDTH, DEVICE_HEIGHT } from '../hldLayout.js'

// v2.3 §7.1 cable media colours (client/src/tokens/design-tokens.js).
export const MEDIA_STROKE = { os2: '#FFD700', om4: '#F4A624', cat6a: '#094F9A', stack: '#2E7D32', dac: '#7B1FA2' }
const BRAND = '#094F9A'

export const escapeXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const clip = (s, n) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// The physical topology: floors, rooms, devices and their links, each link in
// its media colour (dashed when `dashed(conn)` says so, e.g. not installed).
// floors [{ id, name, order }], rooms [{ id, floorId, code }], devices
// [{ id, roomId, hostname, label, model, role }], connections [{ source, dest, media }].
export function topologySvg({ floors, rooms, devices, connections, dashed = () => false, title = null }) {
  const devicesByRoom = {}
  for (const d of devices) if (d.roomId) (devicesByRoom[d.roomId] ??= []).push(d)
  const { floorBands, roomNodes, deviceNodes } = computeHldLayout({ floors: floors.map((f) => ({ ...f, name: f.name ?? f.token ?? '' })), rooms, devicesByRoom })
  const width = Math.max(600, ...roomNodes.map((r) => r.x + r.width + 40))
  const height = Math.max(200, ...floorBands.map((b) => b.y + b.height)) + 10
  const roomById = new Map(roomNodes.map((r) => [r.id, r]))
  const pos = new Map()
  for (const n of deviceNodes) {
    const room = roomById.get(n.parentId)
    pos.set(n.deviceId, { x: room.x + n.x, y: room.y + n.y, label: n.label, sublabel: n.sublabel })
  }
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial, Helvetica, sans-serif">`, `<rect width="${width}" height="${height}" fill="#ffffff"/>`]
  if (title) parts.push(`<title>${escapeXml(title)}</title>`)
  for (const b of floorBands) {
    parts.push(`<rect x="0" y="${b.y}" width="${width}" height="${b.height}" fill="#F7F8FA" stroke="#E2E5EA"/>`, `<text x="12" y="${b.y + 22}" font-size="13" font-weight="700" fill="#3D4452">${escapeXml(b.label)}</text>`)
  }
  for (const r of roomNodes) {
    parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="8" fill="#ffffff" stroke="#C7CCD6"/>`, `<text x="${r.x + 10}" y="${r.y + 20}" font-size="12" font-weight="700" fill="#1F2430">${escapeXml(r.label)}</text>`)
  }
  for (const c of connections) {
    const a = pos.get(String(c.source.deviceId))
    const b = pos.get(String(c.dest.deviceId))
    if (!a || !b) continue
    const x1 = a.x + DEVICE_WIDTH / 2
    const y1 = a.y + DEVICE_HEIGHT / 2
    const x2 = b.x + DEVICE_WIDTH / 2
    const y2 = b.y + DEVICE_HEIGHT / 2
    const stroke = MEDIA_STROKE[c.media] ?? BRAND
    parts.push(`<path d="M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" fill="none" stroke="${dashed(c) ? '#8A909C' : stroke}" stroke-width="2.5"${dashed(c) ? ' stroke-dasharray="6 4"' : ''}/>`)
  }
  for (const [, p] of pos) {
    parts.push(
      `<rect x="${p.x}" y="${p.y}" width="${DEVICE_WIDTH}" height="${DEVICE_HEIGHT}" rx="6" fill="#DCE8F5" stroke="${BRAND}"/>`,
      `<text x="${p.x + 8}" y="${p.y + 17}" font-size="10" font-weight="700" fill="#1F2430">${escapeXml(clip(p.label, 26))}</text>`,
      `<text x="${p.x + 8}" y="${p.y + 31}" font-size="9" fill="#5B6270">${escapeXml(clip(p.sublabel, 30))}</text>`
    )
  }
  parts.push('</svg>')
  return parts.join('')
}

// A rack elevation, front and rear side by side. placements [{ ru, heightU,
// face ('front'|'rear'), fullDepth, mounting ('rack'|'0U'), label, sublabel, kind }].
export function rackElevationSvg({ code, heightU = 42, placements = [], roomCode = null }) {
  const U = 12
  const W = 220
  const GAP = 40
  const TOP = 34
  const width = W * 2 + GAP + 60
  const height = TOP + heightU * U + 30
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial, Helvetica, sans-serif">`, `<rect width="${width}" height="${height}" fill="#ffffff"/>`]
  parts.push(`<text x="30" y="16" font-size="13" font-weight="700" fill="#1F2430">Rack ${escapeXml(code)}${roomCode ? ` · ${escapeXml(roomCode)}` : ''} (${heightU}U)</text>`)
  ;['front', 'rear'].forEach((face, i) => {
    const x0 = 30 + i * (W + GAP)
    parts.push(`<text x="${x0}" y="${TOP - 6}" font-size="10" font-weight="700" fill="#5B6270">${face === 'front' ? 'Front' : 'Rear'}</text>`, `<rect x="${x0}" y="${TOP}" width="${W}" height="${heightU * U}" fill="#F4F5F7" stroke="#8A909C"/>`)
    for (let u = 1; u <= heightU; u++) {
      const y = TOP + (heightU - u) * U
      parts.push(`<line x1="${x0}" y1="${y}" x2="${x0 + W}" y2="${y}" stroke="#E2E5EA" stroke-width="0.5"/>`)
      if (u % 2 === 1) parts.push(`<text x="${x0 - 4}" y="${y + U - 3}" font-size="7" text-anchor="end" fill="#8A909C">${u}</text>`)
    }
    for (const p of placements) {
      if (p.mounting === '0U' || !p.ru) continue
      if (p.face !== face && !p.fullDepth) continue
      const h = Math.max(1, p.heightU ?? 1)
      const y = TOP + (heightU - (p.ru + h - 1)) * U
      const blocked = p.kind && p.kind !== 'device'
      parts.push(
        `<rect x="${x0 + 2}" y="${y + 1}" width="${W - 4}" height="${h * U - 2}" rx="2" fill="${blocked ? '#FDECEF' : p.face === face ? '#DCE8F5' : '#EEF1F5'}" stroke="${blocked ? '#ED1A4C' : BRAND}" stroke-width="0.8"/>`,
        `<text x="${x0 + 6}" y="${y + Math.min(h * U, U) - 3}" font-size="8" fill="#1F2430">${escapeXml(clip(p.label, 34))}${p.sublabel && h > 1 ? '' : ''}</text>`
      )
    }
  })
  const zeroU = placements.filter((p) => p.mounting === '0U' || !p.ru)
  if (zeroU.length) parts.push(`<text x="30" y="${height - 10}" font-size="9" fill="#5B6270">0U: ${escapeXml(zeroU.map((p) => p.label).join(', '))}</text>`)
  parts.push('</svg>')
  return parts.join('')
}
