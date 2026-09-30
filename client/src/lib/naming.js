// Hostname generation per brief v2.3 §6.6.
// Pattern: {role}-{country}-{sal}-{campus}-{building}-{floor}-{seq}
// Floor tokens strip characters invalid in hostnames (dots, spaces).

export const ROLE_CODES = {
  fusion: 'F',
  border: 'B',
  distribution: 'D',
  edge: 'E',
  ap: 'A',
}

export function floorToken(token) {
  return token.replace(/[.\s]/g, '')
}

export function buildHostname({ role, country, sal, campus, building, floor, seq }) {
  const seqStr = String(seq).padStart(3, '0')
  return `${role}-${country}-${sal}-${campus}-${building}-${floorToken(floor)}-${seqStr}`
}
