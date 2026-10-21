// Contextual field help — the ⓘ next to a field label (brief v2.2 §18; M7a-2).
// Each field's help has up to four texts and reference photos. The platform
// default for a survey field is its hint from survey-fields.json, marked as a
// placeholder until the Technonex tooltip content replaces it; an Org Admin
// can override any part and add photos. All text is plain text: never HTML.
import { SURVEY_TABS } from './surveyForm.js'

export const HELP_PARTS = [
  { key: 'meaning', label: 'What this field means' },
  { key: 'lookFor', label: 'What to look for' },
  { key: 'example', label: 'Example value' },
  { key: 'mistakes', label: 'Common mistakes' },
]
export const HELP_PART_KEYS = HELP_PARTS.map((p) => p.key)
export const HELP_TEXT_MAX = 1000
export const HELP_PHOTOS_MAX = 6
export const HELP_PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const HELP_KEY_PATTERN = /^survey:[a-z0-9-]+:[a-z0-9_]+$/

// survey:<tab slug>:<field key> — one help per field of a tab (the same key in
// two tabs can mean different things).
const slug = (tab) => tab.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
export const surveyHelpKey = (tab, fieldKey) => `survey:${slug(tab)}:${fieldKey}`

// Every survey field, with where it sits — the Org Admin's list of fields.
export const SURVEY_HELP_FIELDS = SURVEY_TABS.flatMap((t) =>
  t.sections.flatMap((s) =>
    (s.fields ?? []).map((f) => ({ key: surveyHelpKey(t.tab, f.key), tab: t.tab, section: s.section, label: f.label, hint: f.hint ?? null }))
  )
).filter((f, i, all) => all.findIndex((x) => x.key === f.key) === i)
const byKey = new Map(SURVEY_HELP_FIELDS.map((f) => [f.key, f]))
export const isHelpKey = (key) => byKey.has(key)
export const helpFieldOf = (key) => byKey.get(key) ?? null

// The platform default: the field's hint, as a placeholder; null without one.
export function platformHelp(key) {
  const f = byKey.get(key)
  if (!f?.hint) return null
  return { meaning: f.hint, lookFor: null, example: null, mistakes: null, placeholder: true }
}

// Plain text as stored: newlines kept (\r\n → \n), other control characters
// removed, trimmed, capped; empty → null. Markup is kept as typed and shown
// as text, never interpreted.
export function plainText(value, max = HELP_TEXT_MAX) {
  if (value == null) return null
  const s = String(value)
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim()
  return s ? s.slice(0, max) : null
}

// What a field shows: the organisation's texts over the platform default
// (part by part); placeholder only while every shown text is the default's.
export function mergedHelp(key, override = null) {
  const base = platformHelp(key)
  const parts = {}
  let fromOrg = false
  for (const p of HELP_PART_KEYS) {
    const own = override?.[p] ?? null
    if (own) fromOrg = true
    parts[p] = own ?? base?.[p] ?? null
  }
  const photos = override?.photos ?? []
  const hasText = HELP_PART_KEYS.some((p) => parts[p])
  if (!hasText && !photos.length) return null
  return { key, ...parts, photos, placeholder: Boolean(base) && !fromOrg, overridden: fromOrg || photos.length > 0 }
}
