// Global seeded catalogue (layer `seeded`). PLACEHOLDER DATA: these are the
// models the prototype already uses (client/src/mock/deviceCatalogue.js,
// sfpCatalog.js, rackLibrary.js), carried over so the real backend has
// something to show until Technonex supplies the real catalogue (brief v2.3
// §6.5, §8.3). Values the prototype never had (weight, power draw, PoE budget,
// artwork) are left empty rather than guessed, and passive/infrastructure
// items are unpriced. Port numbering matches shared/portMap.js exactly, so
// the prototype's port IDs survive the move to catalogue-driven port maps.
//
// Every row is flagged `placeholder: true` and shown as such in the UI.

const cisco = (fields) => ({ vendor: 'Cisco', currency: 'EUR', ...fields })
const generic = (fields) => ({ vendor: 'Generic', currency: 'EUR', ...fields })

const optic = (model, media, speed, reachM, price) =>
  cisco({ kind: 'optic', category: 'accessory', model, mediaSpeed: { media, speed, reachM }, unitPriceMinor: price * 100 })

const TEN_G_OPTICS = ['Cisco SFP-10G-SR', 'Cisco SFP-10G-LR', 'Cisco SFP-10G-ER', 'Cisco DAC-10G']

export const SEEDED_CATALOGUE = [
  cisco({
    kind: 'device_model',
    category: 'switch',
    model: 'C9300-48UX',
    description: 'Catalyst 9300 48-port UPOE access switch (Edge)',
    heightU: 1,
    rackMounted: true,
    mounting: 'front',
    powerInletType: 'C14',
    psuCount: 2,
    needsUplinkModule: true,
    portMap: {
      groups: [
        { role: 'access', type: 'RJ45', speed: '1G', poe: true, count: 48, start: 1, pattern: 'Gi1/0/{n}' },
        { role: 'module', type: 'SFP+', speed: '10G', poe: false, count: 8, start: 1, pattern: 'Te1/1/{n}' },
      ],
    },
    compatibleSfps: TEN_G_OPTICS,
    compatiblePsus: ['Cisco PWR-C1-715WAC'],
    compatibleModules: ['Cisco C9300-NM-8X'],
    unitPriceMinor: 420000,
  }),
  cisco({
    kind: 'device_model',
    category: 'switch',
    model: 'C9500',
    description: 'Catalyst 9500 core switch (Fusion, Border, Distribution)',
    heightU: 1,
    rackMounted: true,
    mounting: 'front',
    powerInletType: 'C14',
    psuCount: 2,
    portMap: { groups: [{ role: 'access', type: 'SFP+', speed: '10G', poe: false, count: 24, start: 1, pattern: 'Te1/1/{n}' }] },
    compatibleSfps: TEN_G_OPTICS,
    unitPriceMinor: 850000,
  }),
  cisco({
    kind: 'device_model',
    category: 'ap',
    model: 'Catalyst 9130AXI',
    description: 'Wi-Fi 6 access point, ceiling mount, PoE powered',
    heightU: 0,
    rackMounted: false,
    portMap: { groups: [{ role: 'uplink', type: 'RJ45', speed: '2.5G', poe: false, count: 1, start: 0, pattern: 'Eth{n}' }] },
    unitPriceMinor: 65000,
  }),
  generic({
    kind: 'device_model',
    category: 'patch_panel',
    model: 'Cat6A Patch Panel 24-port',
    heightU: 1,
    rackMounted: true,
    mounting: 'front',
    portMap: { groups: [{ role: 'access', type: 'RJ45', speed: null, poe: false, count: 24, start: 1, pattern: '{n:2}' }] },
  }),
  generic({
    kind: 'device_model',
    category: 'patch_panel',
    model: 'Cat6A Patch Panel 48-port',
    heightU: 1,
    rackMounted: true,
    mounting: 'front',
    portMap: { groups: [{ role: 'access', type: 'RJ45', speed: null, poe: false, count: 48, start: 1, pattern: '{n:2}' }] },
  }),
  generic({
    kind: 'device_model',
    category: 'patch_panel',
    model: 'LC Fibre Patch Panel 24-port',
    description: '24 LC duplex ports',
    heightU: 1,
    rackMounted: true,
    mounting: 'front',
    portMap: { groups: [{ role: 'access', type: 'LC duplex', speed: null, poe: false, count: 24, start: 1, pattern: '{n:2}' }] },
  }),
  generic({ kind: 'device_model', category: 'cable_management', model: 'Cable Manager 1U', heightU: 1, rackMounted: true, mounting: 'front' }),
  generic({ kind: 'device_model', category: 'pdu', model: 'PDU 0U', description: 'Vertical rail PDU, 24 sockets', heightU: 0, rackMounted: true, mounting: '0U' }),
  generic({ kind: 'device_model', category: 'ups', model: 'UPS 3U', heightU: 3, rackMounted: true, mounting: 'front' }),
  optic('SFP-10G-LR', 'os2', '10G', 10000, 180),
  optic('SFP-10G-ER', 'os2', '10G', 40000, 420),
  optic('SFP-1G-LX', 'os2', '1G', 10000, 95),
  optic('SFP-10G-SR', 'om4', '10G', 400, 110),
  optic('SFP-40G-SR4', 'om4', '40G', 400, 540),
  optic('SFP-1G-SX', 'om4', '1G', 550, 65),
  optic('DAC-10G', 'dac', '10G', 5, 55),
  optic('STACK-CABLE', 'stack', '10G', 3, 40),
  cisco({ kind: 'consumable', category: 'accessory', model: 'C9300-NM-8X', description: '8 x 10G SFP+ network module', unitPriceMinor: 78000 }),
  cisco({ kind: 'consumable', category: 'accessory', model: 'PWR-C1-715WAC', description: '715 W AC power supply', unitPriceMinor: 31000 }),
]
