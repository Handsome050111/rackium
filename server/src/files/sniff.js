// What a file really is, from its first bytes — the declared MIME type and
// file name are not trusted (DATA-MODEL §9.2: JPG, PNG, HEIC, WebP photos;
// PDF; Excel and CSV).
export function sniffKind(head) {
  const b = head
  const ascii = (start, end) => b.subarray(start, end).toString('latin1')
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'photo', mimeType: 'image/jpeg' }
  if (b.length >= 8 && ascii(0, 8) === '\x89PNG\r\n\x1a\n') return { kind: 'photo', mimeType: 'image/png' }
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'photo', mimeType: 'image/webp' }
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'hevc', 'heim', 'heis'].includes(ascii(8, 12))) return { kind: 'photo', mimeType: 'image/heic' }
  if (b.length >= 5 && ascii(0, 5) === '%PDF-') return { kind: 'pdf', mimeType: 'application/pdf' }
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return { kind: 'sheet', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return { kind: 'sheet', mimeType: 'application/vnd.ms-excel' }
  return null
}

// CSV has no signature: accept it only when declared as CSV and the start
// is plain text (no NUL bytes, valid UTF-8).
export function looksLikeCsv(head, declaredMimeType, fileName) {
  const declared = /csv/i.test(declaredMimeType) || /\.csv$/i.test(fileName)
  if (!declared || head.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 4)))
    return true
  } catch {
    return false
  }
}

// Which kinds each category accepts.
export const CATEGORY_KINDS = {
  photo_room: ['photo'],
  photo_rack: ['photo'],
  photo_reference: ['photo'],
  photo_device_label: ['photo'],
  evidence: ['photo', 'pdf'],
  document: ['photo', 'pdf', 'sheet'],
}

// Limits come from organisation settings on each request (DATA-MODEL §9.2).
export function limitBytesFor(kind, limits) {
  const uploadLimitsMb = limits ?? {}
  const mb = { photo: uploadLimitsMb.photo ?? 15, pdf: uploadLimitsMb.pdf ?? 25, sheet: uploadLimitsMb.sheet ?? 10 }[kind]
  return Math.round(mb * 1024 * 1024)
}

// The kind a declared MIME type claims — used to size the upload before any
// bytes arrive; the real kind is sniffed on completion and must agree.
export function declaredKind(mimeType, fileName) {
  if (/^image\/(jpeg|png|webp|heic|heif)$/i.test(mimeType)) return 'photo'
  if (/pdf/i.test(mimeType)) return 'pdf'
  if (/spreadsheet|excel|csv/i.test(mimeType) || /\.(xlsx|xls|csv)$/i.test(fileName)) return 'sheet'
  return null
}
