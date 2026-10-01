// SFP/optic catalogue (brief v2.3 §6.4: the media length limit comes from
// the selected optic's reach; §6.5: unit price added to the catalogue).
// Each entry names which media+speed combination it's valid for, its
// reach — the real source for "distance vs optic limit" checks, not a
// hand-typed pass/fail — and its unit price for BOM costing.
export const SFP_CATALOG = [
  { code: 'SFP-10G-LR', media: 'os2', speed: '10G', reachM: 10000, unitPrice: 180 },
  { code: 'SFP-10G-ER', media: 'os2', speed: '10G', reachM: 40000, unitPrice: 420 },
  { code: 'SFP-1G-LX', media: 'os2', speed: '1G', reachM: 10000, unitPrice: 95 },
  { code: 'SFP-10G-SR', media: 'om4', speed: '10G', reachM: 400, unitPrice: 110 },
  { code: 'SFP-40G-SR4', media: 'om4', speed: '40G', reachM: 400, unitPrice: 540 },
  { code: 'SFP-1G-SX', media: 'om4', speed: '1G', reachM: 550, unitPrice: 65 },
  { code: 'DAC-10G', media: 'dac', speed: '10G', reachM: 5, unitPrice: 55 },
  { code: 'STACK-CABLE', media: 'stack', speed: '10G', reachM: 3, unitPrice: 40 },
]

export function getCompatibleSfps(media, speed) {
  return SFP_CATALOG.filter((s) => s.media === media && s.speed === speed)
}

export function getSfp(code) {
  return SFP_CATALOG.find((s) => s.code === code)
}

export function isSfpValidForMedia(sfpCode, media, speed) {
  const sfp = getSfp(sfpCode)
  return Boolean(sfp && sfp.media === media && sfp.speed === speed)
}
