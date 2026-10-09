// HLD device roles (brief v2.3 §5.3, §6.6; DATA-MODEL §4.1, §7). One table
// for everything a role decides: its catalogue category, its hostname role
// code, its canvas icon and how it appears in the BOM. Used by the HLD
// library, Generate HLD, hostname generation, validation and the BOM.

import { buildHostname } from './naming.js'

// Default hostname role codes. F/B/D/E/A are the brief's (§6.6); the rest
// are PROPOSED — client to confirm (DATA-MODEL §7). An organisation can
// change any of them in its naming settings.
export const DEFAULT_ROLE_CODES = {
  fusion: 'F',
  border: 'B',
  distribution: 'D',
  edge: 'E',
  ap: 'A',
  firewall: 'FW',
  router: 'R',
  wlc: 'WC',
  server: 'SV',
  ups: 'UP',
  pdu: 'PD',
  sensor: 'SN',
}
export const PROPOSED_ROLE_CODE_KEYS = ['firewall', 'router', 'wlc', 'server', 'ups', 'pdu', 'sensor']

// bom: section (BOM section heading), label (line text), procured (false =
// provider-supplied, no BOM line). `named`: gets a hostname.
export const HLD_ROLES = [
  { role: 'fusion', label: 'Fusion', group: 'active_networking', category: 'switch', icon: 'fusion', named: true, bom: { section: 'Network devices', label: 'Fusion switch', procured: true } },
  { role: 'border', label: 'Border', group: 'active_networking', category: 'switch', icon: 'border', named: true, bom: { section: 'Network devices', label: 'Border switch', procured: true } },
  { role: 'distribution', label: 'Distribution', group: 'active_networking', category: 'switch', icon: 'distribution', named: true, bom: { section: 'Network devices', label: 'Distribution switch', procured: true } },
  { role: 'edge', label: 'Edge', group: 'active_networking', category: 'switch', icon: 'edge', named: true, bom: { section: 'Network devices', label: 'Edge switch', procured: true } },
  { role: 'ap', label: 'AP', group: 'active_networking', category: 'ap', icon: 'ap', named: true, bom: { section: 'Network devices', label: 'Wireless access point', procured: true } },
  { role: 'firewall', label: 'Firewall', group: 'active_networking', category: 'firewall', icon: 'firewall', named: true, bom: { section: 'Network devices', label: 'Firewall', procured: true } },
  { role: 'router', label: 'Router', group: 'active_networking', category: 'router', icon: 'router', named: true, bom: { section: 'Network devices', label: 'Router', procured: true } },
  { role: 'wlc', label: 'WLC', group: 'active_networking', category: 'wlc', icon: 'wlc', named: true, bom: { section: 'Network devices', label: 'Wireless LAN controller', procured: true } },
  { role: 'server', label: 'Server', group: 'server', category: 'server', icon: 'server', named: true, bom: { section: 'Network devices', label: 'Server', procured: true } },
  { role: 'ups', label: 'UPS', group: 'infrastructure', category: 'ups', icon: 'ups', named: true, bom: { section: 'Power & accessories', label: 'UPS', procured: true } },
  { role: 'pdu', label: 'PDU', group: 'infrastructure', category: 'pdu', icon: 'pdu', named: true, bom: { section: 'Power & accessories', label: 'PDU', procured: true } },
  { role: 'sensor', label: 'Sensor', group: 'infrastructure', category: 'sensor', icon: 'sensor', named: true, bom: { section: 'Power & accessories', label: 'Environment sensor', procured: true } },
  { role: 'wan_circuit', label: 'WAN/SP connection', group: 'external', category: 'wan_sp_connection', icon: 'wan-circuit', named: false, bom: { section: null, label: 'WAN/SP connection', procured: false } },
  { role: 'remote_site', label: 'Remote site', group: 'external', category: 'remote_site', icon: 'remote-site', named: false, bom: { section: null, label: 'Remote site', procured: false } },
]
export const HLD_ROLE_KEYS = HLD_ROLES.map((r) => r.role)
export const roleInfo = (role) => HLD_ROLES.find((r) => r.role === role) ?? null

// The catalogue model a new device of a role gets by default: the
// prototype's models for the original five roles, otherwise the first
// device model of the role's category. `catalogue` = resolved catalogue items.
export const PREFERRED_MODELS = {
  fusion: 'Cisco C9500',
  border: 'Cisco C9500',
  distribution: 'Cisco C9500',
  edge: 'Cisco C9300-48UX',
  ap: 'Cisco Catalyst 9130AXI',
}
export function defaultModelFor(role, catalogue) {
  const info = roleInfo(role)
  if (!info) return null
  const models = (catalogue ?? []).filter((i) => i.kind === 'device_model' && i.category === info.category)
  const preferred = PREFERRED_MODELS[role]
  return models.find((i) => preferred && i.key.toLowerCase() === preferred.toLowerCase()) ?? models[0] ?? null
}

// The organisation's codes over the defaults. Codes are 1-4 upper-case
// letters/digits (they become part of a hostname).
export const ROLE_CODE_PATTERN = /^[A-Z0-9]{1,4}$/
export function resolveRoleCodes(orgCodes = {}) {
  const out = { ...DEFAULT_ROLE_CODES }
  for (const [role, code] of Object.entries(orgCodes ?? {})) if (role in DEFAULT_ROLE_CODES && ROLE_CODE_PATTERN.test(String(code))) out[role] = code
  return out
}

// Codes must be distinct, or two roles would share a hostname series.
export function duplicateRoleCodes(codes) {
  const seen = new Map()
  const dupes = []
  for (const [role, code] of Object.entries(codes)) {
    if (seen.has(code)) dupes.push(`${seen.get(code)} and ${role} both use ${code}`)
    else seen.set(code, role)
  }
  return dupes
}

// The next hostname for a role on a floor (brief §6.6: 3-digit sequence per
// role per floor). `existing` = hostnames already in the project; the next
// free sequence is used, so a deleted device's number is never re-issued
// while it still exists elsewhere and generation stays deterministic.
// Returns null for roles that carry no hostname (WAN, remote site).
export function nextHostname(role, { codes, country, sal, campus, building, floor }, existing) {
  const info = roleInfo(role)
  if (!info?.named) return null
  const code = resolveRoleCodes(codes)[role]
  const taken = new Set((existing ?? []).filter(Boolean).map((h) => h.toUpperCase()))
  for (let seq = 1; seq < 1000; seq++) {
    const hostname = buildHostname({ role: code, country, sal, campus, building, floor, seq })
    if (!taken.has(hostname.toUpperCase())) return hostname
  }
  return null
}

// BOM rule per role (brief §5.6): one line per role and model, quantity =
// device count; provider-supplied roles produce no line. Serialised device
// categories get one procurement line per device later (DATA-MODEL §4.10);
// this is the design-level summary the BOM starts from.
export function bomDeviceLines(devices) {
  const lines = new Map()
  for (const d of devices) {
    const info = roleInfo(d.role)
    if (!info || !info.bom.procured) continue
    const key = `${d.role}|${d.catalogueKey ?? d.model ?? ''}`
    const line = lines.get(key) ?? { key, role: d.role, section: info.bom.section, item: info.bom.label, model: d.catalogueKey ?? d.model ?? null, qty: 0 }
    line.qty += 1
    lines.set(key, line)
  }
  return [...lines.values()].sort((a, b) => HLD_ROLE_KEYS.indexOf(a.role) - HLD_ROLE_KEYS.indexOf(b.role))
}
