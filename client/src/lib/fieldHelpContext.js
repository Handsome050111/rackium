import { createContext, useContext } from 'react'
import { surveyHelpKey } from '@rackium/shared/fieldHelp.js'
import { fieldHelpApi } from '../api/m7a2Api.js'

// Field help for the survey forms (M7a-2): loaded once per organisation and
// shared by every ⓘ of a tab. Only real mode provides it (FieldHelpProvider)
// — without a provider (the mock prototype) no ⓘ is shown.
export const FieldHelpContext = createContext(null)
export const FieldKeyContext = createContext(null)

const cache = new Map() // orgId → Promise<Map(key → help)>
export function invalidateFieldHelp(orgId) {
  cache.delete(orgId)
}
export function loadFieldHelp(orgId) {
  if (!cache.has(orgId)) {
    cache.set(
      orgId,
      fieldHelpApi
        .list(orgId)
        .then((r) => new Map(r.fields.filter((f) => f.help).map((f) => [f.key, f.help])))
        .catch((err) => {
          cache.delete(orgId)
          throw err
        })
    )
  }
  return cache.get(orgId)
}

// The help of a field of the current tab (null: none, or no provider).
export function useFieldHelp(fieldKey) {
  const ctx = useContext(FieldHelpContext)
  if (!ctx || !fieldKey || !ctx.tab) return null
  return ctx.byKey.get(surveyHelpKey(ctx.tab, fieldKey)) ?? null
}

// Whether any of these fields of the current tab has help (one context read).
export function useAnyFieldHelp(fieldKeys) {
  const ctx = useContext(FieldHelpContext)
  if (!ctx || !ctx.tab) return false
  return fieldKeys.some((k) => ctx.byKey.has(surveyHelpKey(ctx.tab, k)))
}
