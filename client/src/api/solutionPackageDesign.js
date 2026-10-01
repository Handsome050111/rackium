// Solution Package (brief v2.3 §5.5, v2.2 §3.7A, Step 7). Three pages: 18
// generated sections, the 12-group Required Inputs register, and
// Validation & Approval Readiness. All status/completeness is calculated
// from real HLD/LLD/BOM/Required-Inputs state — sections 8-14 read their
// completeness directly from the matching Required Inputs group rather
// than being independently fabricated numbers.
import { getLldContext } from './lldDesign.js'
import { getBomContext } from './bomDesign.js'
import { getRequiredInputsContext } from './requiredInputsStore.js'
import { getPhaseCards, updatePhaseStatus } from './buildings.js'
import { generateShareLink, getActiveShareLink, recordClientDecision, getClientDecision } from './shareLink.js'
import { buildResourceEstimate } from '../lib/billOfResources.js'
import { getResourceMinutes } from './projectSettings.js'

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const SP_PHASE_ID = 'solution-package'

// Demo identity convention — the app has no real auth, so "who did this"
// is always this static user + whichever role is active in the switcher,
// the same convention TopBar.jsx already uses for the account avatar.
const DEMO_USER_NAME = 'Khaista Rehman'
const ROLE_LABEL = { org_admin: 'Org Admin', pm: 'PM', architect: 'Architect', reviewer: 'Reviewer', field_engineer: 'Field Engineer', viewer: 'Viewer' }

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

function groupCompleteness(groups, groupId) {
  const g = groups.find((x) => x.id === groupId)
  if (!g) return 100
  return g.status === 'complete' ? 100 : g.status === 'in_progress' ? 50 : 0
}

async function buildValidationAreas({ lldContext, requiredInputs, bomContext }) {
  const areas = []

  const { realCount, bomCount } = bomContext.reconciliation
  areas.push({
    id: 'source-data',
    name: 'Source-data reconciliation',
    description: 'Survey, HLD, LLD and BOM objects',
    passed: realCount === bomCount ? 1 : 0,
    total: 1,
  })

  areas.push({
    id: 'physical-design',
    name: 'Physical design',
    description: 'Rooms, racks, RU capacity, device roles and pathways',
    passed: lldContext.rackElevations.length,
    total: lldContext.rackElevations.length,
  })

  const portsChecks = [lldContext.checks.portConflicts === 0, lldContext.checks.duplicateCableIds === 0, lldContext.checks.missingCableIds === 0]
  areas.push({
    id: 'ports-cabling',
    name: 'Ports, cabling and optics',
    description: 'Port uniqueness, cable medium, SFP compatibility and Cable IDs',
    passed: portsChecks.filter(Boolean).length,
    total: portsChecks.length,
  })

  for (const [id, name, description, groupIds] of [
    ['addressing', 'Addressing and segmentation', 'IP pools, VLAN, VN, VRF and rVLAN mappings', ['addressing']],
    ['routing-services', 'Routing and central services', 'BGP, AS numbers, DNS, DHCP, NTP, AAA, ISE and PSN', ['routing', 'central-services']],
    ['catalyst-center', 'Catalyst Center and configuration', 'Hierarchy, LAN automation, golden image and templates', ['catalyst-center', 'software']],
    ['wireless', 'Wireless and RF', 'SSID, authentication, RF profile, AP management and provisioning', ['wireless']],
    ['monitoring', 'Monitoring and assurance', 'Catalyst Center, ThousandEyes, LogicMonitor, tests and alerts', ['monitoring']],
    ['migration', 'Migration, rollback and acceptance', 'CMO-to-FMO mapping, migration sequence, rollback and tests', ['migration', 'testing']],
  ]) {
    const scores = groupIds.map((gid) => groupCompleteness(requiredInputs.groups, gid))
    const passed = scores.filter((s) => s === 100).length
    areas.push({ id, name, description, passed, total: scores.length })
  }

  return areas
}

export async function getSolutionPackageContext(buildingId) {
  // Fetched once and handed to getBomContext below — lldContext.topology
  // already *is* the full HLD context (lldDesign.js builds it that way),
  // and getBomContext would otherwise re-fetch the whole HLD/LLD chain a
  // second time on every single reload.
  const lldContext = await getLldContext(buildingId)
  const hldContext = lldContext.topology

  const [bomContext, requiredInputs, phaseCards, resourceMinutes, activeLink, clientDecision] = await Promise.all([
    getBomContext(buildingId, { lldContext }),
    getRequiredInputsContext(buildingId),
    getPhaseCards(buildingId),
    getResourceMinutes(),
    getActiveShareLink(buildingId),
    (async () => {
      const link = await getActiveShareLink(buildingId)
      return link ? getClientDecision(link.token) : null
    })(),
  ])

  const resourceEstimate = buildResourceEstimate(
    { devices: lldContext.entities.filter((e) => e.type === 'device'), rows: lldContext.rows, racks: lldContext.rackElevations.map((r) => ({ room: r.room })) },
    resourceMinutes
  )

  const connectionsWithCableId = lldContext.rows.filter((r) => r.cableId).length
  const cablingCompleteness = lldContext.rows.length === 0 ? 100 : Math.round((connectionsWithCableId / lldContext.rows.length) * 100)

  const openItemsCount = hldContext.openDesignQuestions + lldContext.checks.portConflicts + lldContext.checks.duplicateCableIds + lldContext.checks.missingCableIds
  const openItemsCompleteness = Math.max(0, 100 - Math.min(100, openItemsCount * 10))

  const validationAreas = await buildValidationAreas({ lldContext, requiredInputs, bomContext })
  const totalChecks = validationAreas.reduce((s, a) => s + a.total, 0)
  const passedChecks = validationAreas.reduce((s, a) => s + a.passed, 0)

  const completenessById = {
    scope: 100,
    site: phaseCards.find((c) => c.id === 'survey')?.status === 'approved' ? 100 : 60,
    physical: lldContext.rackElevations.length > 0 ? 100 : 0,
    naming: hldContext.devices.length > 0 ? 100 : 0,
    diagrams: hldContext.devices.length > 0 && lldContext.rows.length > 0 ? 100 : 50,
    schedules: lldContext.rackElevations.length > 0 && lldContext.portSchedule.length > 0 ? 100 : 50,
    cabling: cablingCompleteness,
    wireless: groupCompleteness(requiredInputs.groups, 'wireless'),
    addressing: groupCompleteness(requiredInputs.groups, 'addressing'),
    'central-services': groupCompleteness(requiredInputs.groups, 'central-services'),
    'config-standards': groupCompleteness(requiredInputs.groups, 'software'),
    monitoring: groupCompleteness(requiredInputs.groups, 'monitoring'),
    migration: groupCompleteness(requiredInputs.groups, 'migration'),
    testing: groupCompleteness(requiredInputs.groups, 'testing'),
    compliance: totalChecks === 0 ? 0 : Math.round((passedChecks / totalChecks) * 100),
    bom: bomContext.reconciliation.reconciled && bomContext.conflicts === 0 ? 100 : 70,
    resources: resourceEstimate.totalMinutes > 0 ? 100 : 0,
    'open-items': openItemsCompleteness,
  }

  const sections = SECTIONS.map((s) => {
    const completeness = completenessById[s.id] ?? 0
    let status
    if (s.id === 'bom') status = bomContext.status === 'approved' ? 'validated' : completeness === 100 ? 'under_review' : 'input_required'
    else if (s.inputGroup) status = completeness === 100 ? 'validated' : completeness === 0 ? 'input_required' : 'generated'
    else status = completeness === 100 ? 'validated' : completeness === 0 ? 'input_required' : 'generated'
    return { ...s, completeness, status }
  })

  const packageCompleteness = Math.round(sections.reduce((s, sec) => s + sec.completeness, 0) / sections.length)
  const inputsRequired = requiredInputs.totalCount - requiredInputs.completeCount

  const spPhase = phaseCards.find((c) => c.id === SP_PHASE_ID)

  return resolveAfter({
    sections,
    packageCompleteness,
    inputsRequired,
    criticalConflicts: lldContext.checks.portConflicts + lldContext.checks.duplicateCableIds,
    requiredInputs,
    resourceEstimate,
    resourceMinutes,
    validationAreas: validationAreas.map((a) => ({ ...a, result: a.passed === a.total ? 'passed' : 'warning' })),
    checksPassed: passedChecks,
    checksTotal: totalChecks,
    readyForSubmission: requiredInputs.allComplete && lldContext.checks.portConflicts === 0 && lldContext.checks.duplicateCableIds === 0,
    status: spPhase?.status ?? 'not_started',
    activeLink,
    clientDecision,
  })
}

const warningsByBuilding = {} // buildingId -> [{id, areaId, text, acceptedBy, acceptedAt}]
let warningIdCounter = 1

export async function getAcceptedWarnings(buildingId) {
  return resolveAfter([...(warningsByBuilding[buildingId] ?? [])])
}

export async function acceptWarning(buildingId, areaId, text, role) {
  warningsByBuilding[buildingId] ??= []
  const record = { id: `warn-${warningIdCounter++}`, areaId, text, acceptedBy: `${DEMO_USER_NAME} (${ROLE_LABEL[role] ?? role})`, acceptedAt: new Date().toISOString() }
  warningsByBuilding[buildingId].push(record)
  return resolveAfter(record)
}

export async function submitForClientApproval(buildingId, { password, expiryDays }) {
  const link = await generateShareLink(buildingId, { password, expiryDays })
  await updatePhaseStatus(buildingId, SP_PHASE_ID, 'awaiting_approval')
  return resolveAfter(link)
}

// --- Client-side actions (called from the public share-link page) --------

export async function clientApprove(token, { name, role, comments, acceptedTerms, hasSignature }) {
  const result = await recordClientDecision(token, { decision: 'approved', name, role, comments, acceptedTerms, hasSignature })
  if (!result.ok) return result
  await updatePhaseStatus(result.buildingId, SP_PHASE_ID, 'approved')
  // Clear the dashboard/sidebar's "Draft" sub-label (mock/hierarchy.js
  // seeds it statically) now that the procurement BOM is unlocked — the
  // BOM phase's own status is untouched; only the PM's separate
  // approveProcurementBom() in bomDesign.js marks it approved.
  const bomPhase = (await getPhaseCards(result.buildingId)).find((c) => c.id === 'bom')
  if (bomPhase) await updatePhaseStatus(result.buildingId, 'bom', bomPhase.status, null)
  return result
}

export async function clientRequestChanges(token, { name, role, comments, acceptedTerms, hasSignature }) {
  const result = await recordClientDecision(token, { decision: 'changes_requested', name, role, comments, acceptedTerms, hasSignature })
  if (!result.ok) return result
  await updatePhaseStatus(result.buildingId, SP_PHASE_ID, 'changes_requested')
  await updatePhaseStatus(result.buildingId, 'lld', 'in_progress') // brief: "Request changes returns the LLD to In progress"
  return result
}

export async function clientReject(token, { name, role, comments, acceptedTerms, hasSignature }) {
  const result = await recordClientDecision(token, { decision: 'rejected', name, role, comments, acceptedTerms, hasSignature })
  if (!result.ok) return result
  await updatePhaseStatus(result.buildingId, SP_PHASE_ID, 'changes_requested')
  await updatePhaseStatus(result.buildingId, 'lld', 'in_progress')
  return result
}
