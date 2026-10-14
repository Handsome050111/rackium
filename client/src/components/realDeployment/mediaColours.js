import { mediaColors } from '../../tokens/design-tokens.js'

// Stroke colour per cable medium (v2.3 §7.1) — the CMDB route trace and the
// deployment patching cards draw in it.
export const MEDIA_COLOURS = Object.fromEntries(Object.entries(mediaColors).map(([k, v]) => [k, v.stroke]))
export const mediaEdge = (media) => mediaColors[media]?.edge ?? null
