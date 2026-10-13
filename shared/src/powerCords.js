// Power cord selection (brief v2.3 §6.7; DATA-MODEL §4.9), in this order:
// 1. the customer standard the PM set for the project overrides everything;
// 2. a device plugged into a PDU: the PDU socket decides the cord, matched
//    to the device inlet (C13 socket → C13/C14 cord; C19 socket → C19/C20);
// 3. a direct wall socket: the country plug table, matched to the inlet.
// Cord length is the organisation setting (2 m unless changed). Pure.

// The cord end that mates with a device inlet, and with a PDU socket.
const DEVICE_END = { C14: 'C13', C20: 'C19' }
const PDU_END = { C13: 'C14', C19: 'C20' }
export const PDU_SOCKET_TYPES = ['C13', 'C19']

// PLACEHOLDER: Technonex supplies the real table (about 15 rows, brief §6.7).
// Country (ISO 3166 alpha-2) → wall plug.
export const COUNTRY_PLUG_TABLE = {
  DE: 'Schuko',
  AT: 'Schuko',
  NL: 'Schuko',
  ES: 'Schuko',
  SE: 'Schuko',
  FR: 'Type E',
  BE: 'Type E',
  PL: 'Type E',
  CH: 'SEV 1011',
  IT: 'CEI 23-50',
  DK: 'Type K',
  GB: 'BS 1363',
  UK: 'BS 1363',
  IE: 'BS 1363',
  US: 'NEMA 5-15',
}
export const DEFAULT_PLUG = 'Schuko'

// → { connectorPair, label, source, reason }. `source`: customer_standard |
// pdu | country.
export function selectPowerCord({ customerStandard = null, pduSocketType = null, inletType = 'C14', countryCode = null, cordLengthM = 2 }) {
  const inlet = String(inletType ?? 'C14').toUpperCase()
  const deviceEnd = DEVICE_END[inlet] ?? 'C13'
  if (customerStandard?.connectorPair) {
    return { connectorPair: customerStandard.connectorPair, label: customerStandard.label ?? `${cordLengthM} m ${customerStandard.connectorPair} power cord`, source: 'customer_standard', reason: 'Customer standard (project setting)' }
  }
  const socket = pduSocketType ? String(pduSocketType).toUpperCase() : null
  if (socket && PDU_END[socket]) {
    const pair = `${deviceEnd}/${PDU_END[socket]}`
    return { connectorPair: pair, label: `${cordLengthM} m ${pair} power cord`, source: 'pdu', reason: `PDU socket ${socket}, device inlet ${inlet}` }
  }
  const code = String(countryCode ?? '').toUpperCase()
  const plug = COUNTRY_PLUG_TABLE[code] ?? DEFAULT_PLUG
  const pair = `${plug}/${deviceEnd}`
  return { connectorPair: pair, label: `${cordLengthM} m ${pair} power cord`, source: 'country', reason: `Wall socket, country ${code || '—'} (${plug}), device inlet ${inlet}${COUNTRY_PLUG_TABLE[code] ? '' : ' — country not in the plug table, default used'}` }
}
