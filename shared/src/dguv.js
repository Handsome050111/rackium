// DGUV inspection status (brief v2.3 §6.9 / D31): 48-month interval,
// "expiring soon" at <=90 days out, "expiring" at <=30 days, "overdue"
// past the due date. Mains-powered equipment only — a PoE-only device
// (e.g. an AP with no standalone PSU) has no DGUV obligation at all.
export const DGUV_INTERVAL_MONTHS = 48
export const EXPIRING_SOON_DAYS = 90
export const EXPIRING_DAYS = 30

export function addMonths(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export function daysBetween(from, to) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

// Returns null when the device has no DGUV obligation (not mains-powered).
// Otherwise { dueDate, daysRemaining, status: 'valid'|'expiring_soon'|'expiring'|'overdue' }.
export function computeDguvStatus({ lastInspectionDate, mainsPowered }, today = new Date()) {
  if (!mainsPowered) return null
  if (!lastInspectionDate) return { dueDate: null, daysRemaining: null, status: 'overdue' }

  const dueDate = addMonths(new Date(lastInspectionDate), DGUV_INTERVAL_MONTHS)
  const daysRemaining = daysBetween(today, dueDate)

  let status
  if (daysRemaining < 0) status = 'overdue'
  else if (daysRemaining <= EXPIRING_DAYS) status = 'expiring'
  else if (daysRemaining <= EXPIRING_SOON_DAYS) status = 'expiring_soon'
  else status = 'valid'

  return { dueDate, daysRemaining, status }
}

export const DGUV_LABEL = { valid: 'Valid', expiring_soon: 'Expiring soon', expiring: 'Expiring', overdue: 'Overdue' }
