// Handover (brief v2.3 §5.9, v2.2 §3.11, Step 9). Wraps the whole project
// record into a client deliverable — pulls data from every other phase's
// API rather than holding any design data of its own.
import { getPhaseCards, updatePhaseStatus } from './buildings.js'
import { getBomContext } from './bomDesign.js'
import { getDeploymentContext } from './deploymentDesign.js'
import { getCmdbContext } from './cmdbDesign.js'
import { generateShareLink, getActiveShareLink, recordClientDecision, getClientDecision } from './shareLink.js'
import { markHandoverAccepted } from './designFreeze.js'
import { computeChecklist, isReadyToCompile, computeDocumentStatus, handoverPhaseStatus, HANDOVER_DOCUMENTS } from '../lib/handoverModel.js'

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const HANDOVER_PHASE_ID = 'handover'

// buildingId -> { state, compiledAt, reviewedAt, deliveredAt, baseline }
const workflowByBuilding = {}
let baselineCounter = 0

function workflowFor(buildingId) {
  return (workflowByBuilding[buildingId] ??= { state: 'pending', compiledAt: null, reviewedAt: null, deliveredAt: null, baseline: null })
}

async function buildDataBag(buildingId) {
  const [phaseCards, bomContext, deploymentContext, cmdbContext] = await Promise.all([
    getPhaseCards(buildingId),
    getBomContext(buildingId),
    getDeploymentContext(buildingId),
    getCmdbContext(buildingId),
  ])
  const phaseStatus = Object.fromEntries(phaseCards.map((c) => [c.id, c.status]))
  const evidenceCount = deploymentContext.devices.reduce((sum, d) => sum + (d.installation?.evidenceCount ?? 0), 0)

  return {
    phaseStatus,
    solutionPackageApproved: bomContext.solutionPackageApproved,
    bomLines: bomContext.lines,
    deploymentDevices: deploymentContext.devices,
    cmdbAwaitingAcceptance: cmdbContext.kpis.awaitingAcceptance,
    openExceptionCount: deploymentContext.kpis.openIssues,
    evidenceCount,
  }
}

export async function getHandoverContext(buildingId) {
  const workflow = workflowFor(buildingId)
  const activeLink = await getActiveShareLink(buildingId, 'handover')
  const decision = activeLink ? await getClientDecision(activeLink.token) : null
  const data = await buildDataBag(buildingId)
  const checklist = computeChecklist({ ...data, signedOff: workflow.state === 'accepted' })
  const documents = HANDOVER_DOCUMENTS.map((doc) => ({ ...doc, ...computeDocumentStatus(doc.id, data) }))

  return resolveAfter({
    workflowState: workflow.state,
    compiledAt: workflow.compiledAt,
    reviewedAt: workflow.reviewedAt,
    deliveredAt: workflow.deliveredAt,
    baseline: workflow.baseline,
    readyToCompile: isReadyToCompile(checklist),
    checklist,
    documents,
    activeLink,
    decision,
  })
}

export async function compilePackage(buildingId) {
  const data = await buildDataBag(buildingId)
  const checklist = computeChecklist({ ...data, signedOff: false })
  if (!isReadyToCompile(checklist)) return resolveAfter({ ok: false, error: 'The pre-compilation checklist is not green yet.' })

  const workflow = workflowFor(buildingId)
  workflow.state = 'compiled'
  workflow.compiledAt = new Date().toISOString()
  await updatePhaseStatus(buildingId, HANDOVER_PHASE_ID, handoverPhaseStatus(workflow.state))
  return resolveAfter({ ok: true })
}

export async function markUnderReview(buildingId) {
  const workflow = workflowFor(buildingId)
  if (workflow.state !== 'compiled') return resolveAfter({ ok: false, error: 'Compile the package before marking it reviewed.' })
  workflow.state = 'under_review'
  workflow.reviewedAt = new Date().toISOString()
  await updatePhaseStatus(buildingId, HANDOVER_PHASE_ID, handoverPhaseStatus(workflow.state))
  return resolveAfter({ ok: true })
}

export async function sendToClient(buildingId, { password, expiryDays } = {}) {
  const workflow = workflowFor(buildingId)
  if (workflow.state !== 'under_review') return resolveAfter({ ok: false, error: 'Mark the package reviewed before sending it to the client.' })
  const link = await generateShareLink(buildingId, { password, expiryDays, kind: 'handover' })
  workflow.state = 'delivered'
  workflow.deliveredAt = new Date().toISOString()
  await updatePhaseStatus(buildingId, HANDOVER_PHASE_ID, handoverPhaseStatus(workflow.state))
  return resolveAfter(link)
}

// --- Client-side actions (called from the public share-link page) --------

export async function clientAcceptHandover(token, { name, role, comments, acceptedTerms, hasSignature }) {
  const result = await recordClientDecision(token, { decision: 'approved', name, role, comments, acceptedTerms, hasSignature })
  if (!result.ok) return result
  const workflow = workflowFor(result.buildingId)
  workflow.state = 'accepted'
  baselineCounter += 1
  workflow.baseline = { versionLabel: `v${baselineCounter}.0`, frozenAt: new Date().toISOString() }
  markHandoverAccepted(result.buildingId)
  await updatePhaseStatus(result.buildingId, HANDOVER_PHASE_ID, handoverPhaseStatus(workflow.state))
  return result
}

export async function clientRequestHandoverChanges(token, { name, role, comments, acceptedTerms, hasSignature }) {
  const result = await recordClientDecision(token, { decision: 'changes_requested', name, role, comments, acceptedTerms, hasSignature })
  if (!result.ok) return result
  const workflow = workflowFor(result.buildingId)
  workflow.state = 'changes_requested'
  await updatePhaseStatus(result.buildingId, HANDOVER_PHASE_ID, handoverPhaseStatus(workflow.state))
  return result
}

export async function clientRejectHandover(token, { name, role, comments, acceptedTerms, hasSignature }) {
  const result = await recordClientDecision(token, { decision: 'rejected', name, role, comments, acceptedTerms, hasSignature })
  if (!result.ok) return result
  const workflow = workflowFor(result.buildingId)
  workflow.state = 'changes_requested'
  await updatePhaseStatus(result.buildingId, HANDOVER_PHASE_ID, handoverPhaseStatus(workflow.state))
  return result
}

// --- Baseline freeze (brief: "On acceptance the project version is frozen
// as an immutable baseline") — isHandoverAccepted itself now lives in
// api/designFreeze.js (see the comment at the top of that file for why).

export async function getHandoverBaseline(buildingId) {
  return workflowFor(buildingId).baseline
}
