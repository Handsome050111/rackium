// Device/accessory catalogue (brief v2.3 §6.5): unit price, currency, power
// inlet type, PSU count, mounting, vendor, SERVON availability. Nothing
// else in the codebase holds pricing or power-spec data before this file —
// it is the one place BOM quantity/price calculations read from.

export const CURRENCY = 'EUR'

// Keyed by the exact `device.model` string used in mock/b001-site.js and
// mock/hldLibrary.js.
export const DEVICE_CATALOGUE = {
  'Cisco C9500': {
    unitPrice: 8500,
    powerInletType: 'C14',
    psuCount: 2, // redundant PSU standard for core/border switches
    rackMounted: true,
    needsUplinkModule: false,
    vendor: 'Cisco',
    servonAvailable: false,
  },
  'Cisco C9300-48UX': {
    unitPrice: 4200,
    powerInletType: 'C14',
    psuCount: 2,
    rackMounted: true,
    needsUplinkModule: true,
    vendor: 'Cisco',
    servonAvailable: false,
  },
  'Cisco Catalyst 9130AXI': {
    unitPrice: 650,
    powerInletType: null, // PoE-powered from its uplink switch port, no standalone power cord
    psuCount: 0,
    rackMounted: false, // ceiling-mounted
    needsUplinkModule: false,
    vendor: 'Cisco',
    servonAvailable: false,
  },
}

// Not a device role in the data model (brief D36: "normal catalogue
// category", a project-level requirement rather than something derived
// from HLD/LLD topology).
export const PROBE_DEVICE = {
  label: 'Probe device',
  spec: 'Site monitoring probe',
  model: 'ThousandEyes Enterprise Agent',
  unitPrice: 1200,
  vendor: 'Cisco (ThousandEyes)',
  projectQuantity: 2,
}

export const UPLINK_MODULE = {
  label: 'Network / uplink module',
  spec: 'Model-compatible NM',
  model: 'Cisco C9300-NM-8X',
  unitPrice: 780,
  vendor: 'Cisco',
}

export const REDUNDANT_PSU = {
  label: 'Redundant PSU',
  spec: 'Compatible per switch model',
  model: 'Cisco PWR-C1-715WAC',
  unitPrice: 310,
  vendor: 'Cisco',
}

// One cage-nut + screw + washer set per rack mounting point; 4 mounting
// points per rack-mounted device (brief/render: "7 wired switches x 4").
export const CAGE_NUT_SET = {
  label: 'M6 cage-nut set',
  spec: 'Cage nut + screw + washer',
  unitPrice: 0.9,
  vendor: 'SERVON',
  servonAvailable: true,
  mountingPointsPerDevice: 4,
}

// Simple per-metre mock pricing for patch cords / cables, by media (brief
// Step 7: "Cables" is its own BOM section, separate from "Optics & fibre").
export const CABLE_UNIT_PRICE_PER_M = {
  cat6a: 1.2,
  om4: 3.5,
  os2: 2.8,
  dac: 9, // fixed-length products priced as a whole, not truly per metre
  stack: 8,
}
export const CABLE_MINIMUM_PRICE = { cat6a: 4, om4: 12, os2: 10, dac: 45, stack: 25 }

export function getDeviceCatalogueEntry(model) {
  return DEVICE_CATALOGUE[model] ?? null
}

export function cablePrice(media, lengthM) {
  const perM = CABLE_UNIT_PRICE_PER_M[media] ?? 1
  const min = CABLE_MINIMUM_PRICE[media] ?? 5
  return Math.max(min, Math.round(perM * (lengthM ?? 1) * 100) / 100)
}
