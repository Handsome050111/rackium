// Photos are compressed in the browser before upload (DATA-MODEL §9.2:
// photos ≤ 15 MB after compression). Long edge capped, re-encoded as JPEG,
// quality stepped down until it fits. A format the browser cannot decode
// (e.g. HEIC on most desktops) is sent as it is — the server accepts it.

export const PHOTO_LIMIT_BYTES = 15 * 1024 * 1024
export const MAX_EDGE_PX = 2560
const QUALITIES = [0.85, 0.75, 0.6, 0.45]

// Pure: the size that fits `maxEdge` on the long side, keeping the aspect.
export function fitWithin(width, height, maxEdge = MAX_EDGE_PX) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

// Pure: a JPEG name for a re-encoded photo.
export function jpegName(name) {
  const stem = String(name || 'photo').replace(/\.[^./\\]+$/, '')
  return `${stem || 'photo'}.jpg`
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality))
}

// Returns { blob, fileName, mimeType }.
export async function compressPhoto(file) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return { blob: file, fileName: file.name || 'photo', mimeType: file.type || 'application/octet-stream' }
  }
  const original = { width: bitmap.width, height: bitmap.height }
  const { width, height } = fitWithin(original.width, original.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  let blob = null
  for (const quality of QUALITIES) {
    blob = await toBlob(canvas, quality)
    if (blob && blob.size <= PHOTO_LIMIT_BYTES) break
  }
  if (!blob) return { blob: file, fileName: file.name || 'photo', mimeType: file.type }
  // Never make a small photo bigger by re-encoding it.
  if (file.type === 'image/jpeg' && file.size <= blob.size && file.size <= PHOTO_LIMIT_BYTES && width === original.width) return { blob: file, fileName: file.name, mimeType: 'image/jpeg' }
  return { blob, fileName: jpegName(file.name), mimeType: 'image/jpeg' }
}
