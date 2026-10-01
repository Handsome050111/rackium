// Rule-based checks for Solution Package Required Inputs Group 1 (Network
// addressing & segmentation) — brief Step 7: "valid CIDR, VLAN IDs 1-4094,
// no duplicate VLANs, no subnet overlap". Pure, no React, no I/O.

const CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/

export function parseCidr(cidr) {
  const match = CIDR_RE.exec((cidr ?? '').trim())
  if (!match) return null
  const octets = match.slice(1, 5).map(Number)
  const prefix = Number(match[5])
  if (octets.some((o) => o > 255) || prefix > 32) return null
  const ip = octets.reduce((acc, o) => acc * 256 + o, 0)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (ip & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  return { network, broadcast, prefix }
}

export function isValidCidr(cidr) {
  return parseCidr(cidr) != null
}

export function rangesOverlap(a, b) {
  return a.network <= b.broadcast && b.network <= a.broadcast
}

export function isValidVlanId(id) {
  const n = Number(id)
  return Number.isInteger(n) && n >= 1 && n <= 4094
}

// entries: [{ id, vlanId, cidr }]. Returns { findings: [{entryId, field, message}], ok }.
export function validateAddressingEntries(entries) {
  const findings = []

  for (const e of entries) {
    if (e.vlanId !== '' && e.vlanId != null && !isValidVlanId(e.vlanId)) {
      findings.push({ entryId: e.id, field: 'vlanId', message: 'VLAN ID must be between 1 and 4094' })
    }
    if (e.cidr && !isValidCidr(e.cidr)) {
      findings.push({ entryId: e.id, field: 'cidr', message: 'Not a valid CIDR (e.g. 10.10.20.0/23)' })
    }
  }

  const vlanSeen = new Map()
  for (const e of entries) {
    if (!isValidVlanId(e.vlanId)) continue
    const id = Number(e.vlanId)
    if (vlanSeen.has(id)) {
      findings.push({ entryId: e.id, field: 'vlanId', message: `VLAN ${id} is already used by another entry` })
    }
    vlanSeen.set(id, e.id)
  }

  const parsed = entries.map((e) => ({ id: e.id, range: isValidCidr(e.cidr) ? parseCidr(e.cidr) : null })).filter((e) => e.range)
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      if (rangesOverlap(parsed[i].range, parsed[j].range)) {
        findings.push({ entryId: parsed[j].id, field: 'cidr', message: `Subnet overlaps with another entry` })
      }
    }
  }

  return { findings, ok: findings.length === 0 }
}
