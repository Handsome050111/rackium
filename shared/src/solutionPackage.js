// Solution Package (brief v2.3 §5.5; DATA-MODEL §5.5, M5a). Pure: the server
// gathers the facts (design state, findings, BOM, required inputs, accepted
// warnings) and this module calculates the 18 sections' completeness, the 12
// input groups' status, the validation areas and approval readiness. Nothing
// here is stored; it is recalculated on every read.
import { validateAddressingEntries } from './networkAddressingValidation.js'

export const REQUIRED_INPUT_GROUPS = [
  { key: 'addressing', n: 1, name: 'Network addressing and segmentation' },
  { key: 'routing', n: 2, name: 'Routing and SD-WAN integration' },
  { key: 'catalyst-center', n: 3, name: 'Catalyst Center and LAN automation' },
  { key: 'central-services', n: 4, name: 'Central network services' },
  { key: 'security', n: 5, name: 'Security and management access' },
  { key: 'wireless', n: 6, name: 'Wireless and RF design' },
  { key: 'software', n: 7, name: 'Software and configuration standards' },
  { key: 'monitoring', n: 8, name: 'Monitoring and assurance' },
  { key: 'migration', n: 9, name: 'CMO-to-FMO migration' },
  { key: 'testing', n: 10, name: 'Testing and acceptance' },
  { key: 'commercial', n: 11, name: 'Commercial and procurement approval' },
  { key: 'governance', n: 12, name: 'Document governance and client approval' },
]
export const GROUP_KEYS = REQUIRED_INPUT_GROUPS.map((g) => g.key)

export const SECTIONS = [
  { n: 1, id: 'scope', name: 'Document information and scope', category: 'Document & project', generatedFrom: 'Project record' },
  { n: 2, id: 'site', name: 'Site and building information', category: 'Document & project', generatedFrom: 'Physical survey' },
  { n: 3, id: 'physical', name: 'Physical infrastructure', category: 'Physical & design', generatedFrom: 'Survey and rack capture' },
  { n: 4, id: 'naming', name: 'Hardware and naming schedule', category: 'Physical & design', generatedFrom: 'HLD and templates' },
  { n: 5, id: 'diagrams', name: 'HLD and LLD diagrams', category: 'Physical & design', generatedFrom: 'Finalised designs' },
  { n: 6, id: 'schedules', name: 'Rack, RU and port schedules', category: 'Physical & design', generatedFrom: 'Survey and LLD' },
  { n: 7, id: 'cabling', name: 'Cabling and uplink schedules', category: 'Physical & design', generatedFrom: 'LLD' },
  { n: 8, id: 'wireless', name: 'Wireless design', category: 'Logical & services', generatedFrom: 'Survey and HLD', inputGroup: 'wireless' },
  { n: 9, id: 'addressing', name: 'IP, VLAN, VN and VRF design', category: 'Logical & services', generatedFrom: 'Client technical input', inputGroup: 'addressing' },
  { n: 10, id: 'central-services', name: 'Central network services', category: 'Logical & services', generatedFrom: 'Client service standards', inputGroup: 'central-services' },
  { n: 11, id: 'config-standards', name: 'Configuration standards', category: 'Logical & services', generatedFrom: 'Approved templates', inputGroup: 'software' },
  { n: 12, id: 'monitoring', name: 'Monitoring design', category: 'Logical & services', generatedFrom: 'Client monitoring standards', inputGroup: 'monitoring' },
  { n: 13, id: 'migration', name: 'Migration and rollback plan', category: 'Delivery & approval', generatedFrom: 'Project and migration team', inputGroup: 'migration' },
  { n: 14, id: 'testing', name: 'Testing and acceptance', category: 'Delivery & approval', generatedFrom: 'Client acceptance criteria', inputGroup: 'testing' },
  { n: 15, id: 'compliance', name: 'Compliance and validation report', category: 'Delivery & approval', generatedFrom: 'Validation engine' },
  { n: 16, id: 'bom', name: 'BOM and procurement package', category: 'Delivery & approval', generatedFrom: 'Suggested BOM' },
  { n: 17, id: 'resources', name: 'Bill of Resources / work package', category: 'Delivery & approval', generatedFrom: 'Deployment task standards' },
  { n: 18, id: 'open-items', name: 'Assumptions, risks, dependencies and open items', category: 'Delivery & approval', generatedFrom: 'NexAI analysis' },
]

// A group's status: group 1 by the CIDR / VLAN / overlap rules, groups 2–12
// complete when every key/value pair is filled.
export function groupStatus(group) {
  if (group.key === 'addressing') {
    const entries = group.addressingEntries ?? []
    if (entries.length === 0) return 'not_started'
    const filled = entries.every((e) => String(e.cidr ?? '').trim() && e.vlanId !== '' && e.vlanId != null)
    return filled && validateAddressingEntries(entries).ok ? 'complete' : 'in_progress'
  }
  const pairs = group.kvPairs ?? []
  if (pairs.length === 0) return 'not_started'
  return pairs.every((p) => String(p.key ?? '').trim() && String(p.value ?? '').trim()) ? 'complete' : 'in_progress'
}
const completenessOf = (status) => (status === 'complete' ? 100 : status === 'in_progress' ? 50 : 0)

// `facts`: { surveyApproved, hldApproved, lldApproved, hldDeviceCount,
// rackCount, portScheduleCount, connectionCount, cableIdCount, findings:
// { critical, warning }, bom: { reconciled, unpricedCount }, resourceMinutes,
// groups: [{ key, ownerId, dueDate, addressingEntries, kvPairs }],
// acceptedWarnings: [{ areaKey }] }.
export function evaluatePackage(facts) {
  const groups = REQUIRED_INPUT_GROUPS.map((def) => {
    const stored = facts.groups.find((g) => g.key === def.key) ?? { key: def.key }
    const status = groupStatus({ ...stored, key: def.key })
    return { ...def, ...stored, status, entryCount: def.key === 'addressing' ? (stored.addressingEntries ?? []).length : (stored.kvPairs ?? []).length }
  })
  const groupBy = Object.fromEntries(groups.map((g) => [g.key, g]))
  const groupScore = (key) => completenessOf(groupBy[key].status)

  // Validation areas (page 3). Critical design findings are never acceptable;
  // anything else short of passing is a warning the PM or Architect may accept.
  const cableIdsComplete = facts.connectionCount === 0 || facts.cableIdCount === facts.connectionCount
  const area = (key, name, description, passed, total) => ({ key, name, description, passed, total })
  const areas = [
    area('source-data', 'Source-data reconciliation', 'Survey, HLD, LLD and BOM objects', facts.bom.reconciled ? 1 : 0, 1),
    area('design-findings', 'Design validation', 'Critical findings in the HLD/LLD validation engine', facts.findings.critical === 0 ? 1 : 0, 1),
    area('ports-cabling', 'Ports, cabling and optics', 'Port uniqueness, cable medium, SFP compatibility and Cable IDs', [cableIdsComplete, facts.findings.warning === 0].filter(Boolean).length, 2),
    area('pricing', 'BOM pricing', 'Every BOM line priced from the catalogue', facts.bom.unpricedCount === 0 ? 1 : 0, 1),
    area('addressing', 'Addressing and segmentation', 'IP pools, VLAN, VN, VRF and rVLAN mappings', groupScore('addressing') === 100 ? 1 : 0, 1),
    area('routing-services', 'Routing and central services', 'BGP, AS numbers, DNS, DHCP, NTP, AAA, ISE and PSN', ['routing', 'central-services'].filter((k) => groupScore(k) === 100).length, 2),
    area('catalyst-center', 'Catalyst Center and configuration', 'Hierarchy, LAN automation, golden image and templates', ['catalyst-center', 'software'].filter((k) => groupScore(k) === 100).length, 2),
    area('wireless', 'Wireless and RF', 'SSID, authentication, RF profile, AP management and provisioning', groupScore('wireless') === 100 ? 1 : 0, 1),
    area('monitoring', 'Monitoring and assurance', 'Catalyst Center, ThousandEyes, LogicMonitor, tests and alerts', groupScore('monitoring') === 100 ? 1 : 0, 1),
    area('migration', 'Migration, rollback and acceptance', 'CMO-to-FMO mapping, migration sequence, rollback and tests', ['migration', 'testing'].filter((k) => groupScore(k) === 100).length, 2),
  ].map((a) => {
    const accepted = facts.acceptedWarnings.find((w) => w.areaKey === a.key) ?? null
    const passed = a.passed === a.total
    const critical = a.key === 'design-findings' && !passed
    return { ...a, result: passed ? 'passed' : critical ? 'critical' : accepted ? 'accepted' : 'warning', acceptable: !passed && !critical, accepted }
  })
  const checksTotal = areas.reduce((n, a) => n + a.total, 0)
  const checksPassed = areas.reduce((n, a) => n + a.passed, 0)

  const completenessById = {
    scope: 100,
    site: facts.surveyApproved ? 100 : 60,
    physical: facts.rackCount > 0 ? 100 : 0,
    naming: facts.hldDeviceCount > 0 ? 100 : 0,
    diagrams: facts.hldApproved && facts.lldApproved ? 100 : facts.hldDeviceCount > 0 ? 50 : 0,
    schedules: facts.rackCount > 0 && facts.portScheduleCount > 0 ? 100 : 50,
    cabling: facts.connectionCount === 0 ? 100 : Math.round((facts.cableIdCount / facts.connectionCount) * 100),
    wireless: groupScore('wireless'),
    addressing: groupScore('addressing'),
    'central-services': groupScore('central-services'),
    'config-standards': groupScore('software'),
    monitoring: groupScore('monitoring'),
    migration: groupScore('migration'),
    testing: groupScore('testing'),
    compliance: checksTotal === 0 ? 0 : Math.round((checksPassed / checksTotal) * 100),
    bom: facts.bom.reconciled && facts.bom.unpricedCount === 0 ? 100 : 70,
    resources: facts.resourceMinutes > 0 ? 100 : 0,
    'open-items': Math.max(0, 100 - Math.min(100, (facts.findings.critical + facts.findings.warning) * 10)),
  }
  const sections = SECTIONS.map((s) => {
    const completeness = completenessById[s.id] ?? 0
    return { ...s, completeness, status: completeness === 100 ? 'validated' : completeness === 0 ? 'input_required' : 'generated' }
  })
  const packageCompleteness = Math.round(sections.reduce((n, s) => n + s.completeness, 0) / sections.length)

  const completeCount = groups.filter((g) => g.status === 'complete').length
  const blockers = []
  if (!facts.hldApproved) blockers.push('The HLD is not approved')
  if (!facts.lldApproved) blockers.push('The LLD is not approved')
  if (completeCount < groups.length) blockers.push(`${groups.length - completeCount} required input group(s) are not complete`)
  if (facts.findings.critical > 0) blockers.push(`${facts.findings.critical} Critical design finding(s)`)
  const openWarnings = areas.filter((a) => a.result === 'warning')
  if (openWarnings.length) blockers.push(`${openWarnings.length} warning area(s) not accepted`)

  return {
    groups,
    completeCount,
    totalCount: groups.length,
    allComplete: completeCount === groups.length,
    sections,
    packageCompleteness,
    validationAreas: areas,
    checksPassed,
    checksTotal,
    readyForSubmission: blockers.length === 0,
    blockers,
  }
}
