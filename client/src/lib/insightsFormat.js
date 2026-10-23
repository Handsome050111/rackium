import { PHASE_LABELS } from '@rackium/shared/notifications.js'

// Labels shared by the M7a-3 dashboard, workload, analytics and reports screens.
export const phaseName = (k) => (k === 'done' ? 'All phases done' : PHASE_LABELS[k] ?? k ?? '—')
export const pct = (n) => (n == null ? '—' : `${n}%`)
export const scopeNote = (scope) => (scope?.limited ? `Your scope: ${scope.buildings} building(s). Totals count only these.` : `The whole project: ${scope?.buildings ?? 0} building(s).`)
