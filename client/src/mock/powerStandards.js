// Power cord selection (brief v2.3 §6.7): three-step priority —
// (1) a customer standard override set by the PM for this project,
// (2) the PDU socket the device is plugged into, matched to the device's
// inlet, (3) a country plug table matched to the device's inlet. Default
// cord length is an org setting (2m unless changed).
import { registerStore } from '../lib/persistentStore.js'

// Country plug table (Technonex-supplied in the real product; a short mock
// table here since B001 is in Germany).
export const COUNTRY_PLUG_TABLE = {
  DE: { plugType: 'Schuko (CEE 7/4)', label: 'EU Schuko power cord' },
  US: { plugType: 'NEMA 5-15', label: 'US NEMA 5-15 power cord' },
  UK: { plugType: 'BS 1363', label: 'UK BS 1363 power cord' },
}

// PDU socket type -> cord connector pairing. Dormant for B001 today since
// no PDU is placed in any of its racks (see mock/b001-site.js) — the
// chain correctly falls through to the country table instead, rather than
// a PDU placement being invented just to exercise this branch.
export const PDU_SOCKET_CORD = {
  C13: 'C13/C14',
  C19: 'C19/C20',
}

export const DEFAULT_CORD_LENGTH_M = 2

// PM-editable project setting (brief §6.7: "customer standard set by the
// PM for this project overrides everything").
const state = { customerStandard: null } // e.g. { label: '2m C13/C14, black', connectorPair: 'C13/C14' }

registerStore('powerStandards', {
  getSnapshot: () => state,
  restoreSnapshot: (data) => {
    state.customerStandard = data?.customerStandard ?? null
  },
})

export function getCustomerPowerCordStandard() {
  return state.customerStandard
}

export function setCustomerPowerCordStandard(standard) {
  state.customerStandard = standard
}

// Returns { label, connectorPair, source: 'customer-standard'|'pdu'|'country' }.
export function selectPowerCord({ countryCode, powerInletType, pduSocketType }) {
  if (state.customerStandard) {
    return { ...state.customerStandard, source: 'customer-standard' }
  }
  if (pduSocketType && PDU_SOCKET_CORD[pduSocketType]) {
    return {
      label: `${DEFAULT_CORD_LENGTH_M}m ${PDU_SOCKET_CORD[pduSocketType]} power cord (PDU)`,
      connectorPair: PDU_SOCKET_CORD[pduSocketType],
      source: 'pdu',
    }
  }
  const country = COUNTRY_PLUG_TABLE[countryCode] ?? COUNTRY_PLUG_TABLE.DE
  return {
    label: `${DEFAULT_CORD_LENGTH_M}m ${country.label} (${powerInletType ?? 'C14'})`,
    connectorPair: `${country.plugType} to ${powerInletType ?? 'C14'}`,
    source: 'country',
  }
}
