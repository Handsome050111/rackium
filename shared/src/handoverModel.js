// Handover (brief v2.3 §5.9, v2.2 §3.11). Pure calculation only — fetching
// each phase's data lives in api/handoverDesign.js, same split as every
// other phase's lib/ module.

// The 11-document package (v2.2 §3.11). `exportable` docs have a real
// SheetJS export (reusing each phase's own existing export module); the
// rest are PDF/ZIP stubs — "Available with document engine", same as
// Step 7's Export PDF/Word buttons, since there's no document engine here.
export const HANDOVER_DOCUMENTS = [
  { id: 'exec-summary', name: 'Executive summary', format: 'PDF', source: 'All phases', exportable: false },
  { id: 'survey-report', name: 'Survey report', format: 'PDF', source: 'Survey data + photos', exportable: false },
  { id: 'hld-document', name: 'HLD document', format: 'PDF', source: 'Topology diagrams', exportable: false },
  { id: 'lld-document', name: 'LLD document', format: 'PDF', source: 'Rack elevations, port/cable schedules', exportable: false },
  { id: 'cable-matrix', name: 'Cable matrix', format: 'Excel', source: 'CMDB connection data', exportable: true },
  { id: 'bom-final', name: 'BOM (final)', format: 'Excel', source: 'Final quantities with substitutions', exportable: true },
  { id: 'deployment-report', name: 'Deployment report', format: 'PDF', source: 'Installation records, tests, exceptions, photos', exportable: false },
  { id: 'cmdb-extract', name: 'CMDB extract', format: 'CSV + PDF', source: 'Full asset register', exportable: true },
  { id: 'as-built', name: 'As-built vs as-designed', format: 'PDF', source: 'Visual diff with exceptions', exportable: false },
  { id: 'exception-register', name: 'Exception register', format: 'PDF', source: 'All exceptions with resolution notes', exportable: false },
  { id: 'photo-evidence', name: 'Photo evidence pack', format: 'ZIP', source: 'All photos organised by room/rack', exportable: false },
]

// `data` is a pre-fetched bag — phase statuses plus the deeper data each
// item needs to give a real number rather than just echoing the phase
// badge (brief's own pre-compile example: "CMDB: 2 devices missing
// firmware version", not just "CMDB: not done").
export function computeChecklist(data) {
  // LLD has no "approved" status of its own in this app's model — it's
  // frozen as a side effect of Solution Package approval (brief §5.5:
  // "Approval freezes HLD and LLD"), so that's the real "LLD done" signal,
  // not a phase badge that never actually reaches 'approved'.
  const { phaseStatus, solutionPackageApproved, bomLines, deploymentDevices, cmdbAwaitingAcceptance, openExceptionCount, signedOff } = data

  const bomUndelivered = bomLines.filter((l) => l.category === 'Network devices' && l.procurementStatus !== 'Delivered').length
  const installable = deploymentDevices.filter((d) => d.role !== 'wan-circuit')
  const notTested = installable.filter((d) => !['tested', 'accepted', 'in_service'].includes(d.status)).length

  return [
    { id: 'survey', label: 'Survey: all rooms verified and imported', ok: phaseStatus.survey === 'approved', detail: phaseStatus.survey === 'approved' ? 'Verified' : 'Not yet verified' },
    { id: 'hld', label: `HLD: approved`, ok: phaseStatus.hld === 'approved', detail: phaseStatus.hld === 'approved' ? 'Approved' : 'Not yet approved' },
    { id: 'lld', label: `LLD: approved`, ok: solutionPackageApproved, detail: solutionPackageApproved ? 'Frozen by Solution Package approval' : 'Not yet approved' },
    {
      id: 'solution-package',
      label: 'Solution Package: approved',
      ok: phaseStatus['solution-package'] === 'approved',
      detail: phaseStatus['solution-package'] === 'approved' ? 'Approved' : 'Not yet approved',
    },
    { id: 'bom', label: 'BOM: all items delivered', ok: bomUndelivered === 0, detail: bomUndelivered === 0 ? 'All delivered' : `${bomUndelivered} line(s) not yet Delivered` },
    {
      id: 'deployment',
      label: 'Deployment: all devices installed and tested',
      ok: notTested === 0,
      detail: notTested === 0 ? 'All tested' : `${notTested} device(s) not yet tested`,
    },
    {
      id: 'cmdb',
      label: 'CMDB: acceptance complete',
      ok: cmdbAwaitingAcceptance === 0,
      detail: cmdbAwaitingAcceptance === 0 ? 'All accepted' : `${cmdbAwaitingAcceptance} device(s) awaiting acceptance`,
    },
    {
      id: 'exceptions',
      label: 'As-built vs as-designed: exceptions documented',
      ok: true, // open exceptions don't block compilation — they're a document, not a gate
      detail: openExceptionCount === 0 ? 'No open exceptions' : `${openExceptionCount} open exception(s) — will be documented`,
    },
    { id: 'sign-off', label: 'Sign-off: client signature', ok: signedOff, detail: signedOff ? 'Signed' : 'Awaiting client signature' },
  ]
}

// "Ready" ignores the sign-off item itself (that can only happen after
// Delivered) — it's whether the package is ready to COMPILE.
export function isReadyToCompile(checklist) {
  return checklist.filter((c) => c.id !== 'sign-off').every((c) => c.ok)
}

export function computeDocumentStatus(docId, data) {
  const { openExceptionCount, cmdbAwaitingAcceptance, phaseStatus, solutionPackageApproved, evidenceCount } = data
  switch (docId) {
    case 'exception-register':
      return openExceptionCount === 0 ? { ok: true, detail: 'No open exceptions' } : { ok: false, detail: `${openExceptionCount} open exception(s)` }
    case 'cmdb-extract':
    case 'as-built':
      return cmdbAwaitingAcceptance === 0 ? { ok: true, detail: 'CMDB acceptance complete' } : { ok: false, detail: `${cmdbAwaitingAcceptance} device(s) awaiting acceptance` }
    case 'survey-report':
      return phaseStatus.survey === 'approved' ? { ok: true, detail: 'Survey approved' } : { ok: false, detail: 'Survey not yet approved' }
    case 'hld-document':
      return phaseStatus.hld === 'approved' ? { ok: true, detail: 'HLD approved' } : { ok: false, detail: 'HLD not yet approved' }
    case 'lld-document':
    case 'cable-matrix':
      return solutionPackageApproved ? { ok: true, detail: 'LLD frozen by Solution Package approval' } : { ok: false, detail: 'LLD not yet approved' }
    case 'bom-final':
      return phaseStatus.bom === 'approved' ? { ok: true, detail: 'Procurement BOM approved' } : { ok: false, detail: 'Procurement BOM not yet approved' }
    case 'deployment-report':
      return phaseStatus.deployment === 'approved' || phaseStatus.deployment === 'completed'
        ? { ok: true, detail: 'Deployment complete' }
        : { ok: false, detail: 'Deployment not yet complete' }
    case 'photo-evidence':
      return evidenceCount > 0 ? { ok: true, detail: `${evidenceCount} photo(s)` } : { ok: false, detail: 'No evidence photos recorded' }
    case 'exec-summary':
    default:
      return { ok: true, detail: 'Compiled from all phases' }
  }
}

// Handover workflow (v2.2 §3.11): Pending -> Ready -> Compiled -> Under
// review -> Delivered -> Accepted (plus Changes requested, a client
// decision outcome that returns the package for rework).
export const HANDOVER_STATES = ['pending', 'ready', 'compiled', 'under_review', 'delivered', 'accepted', 'changes_requested']

// Maps the fine-grained workflow state onto the shared 7-value phase-badge
// vocabulary every other phase uses (StatusChip/StatusDot only know these).
export function handoverPhaseStatus(workflowState) {
  switch (workflowState) {
    case 'pending':
    case 'ready':
      return 'not_started'
    case 'compiled':
      return 'in_progress'
    case 'under_review':
    case 'delivered':
      return 'awaiting_approval'
    case 'accepted':
      return 'approved'
    case 'changes_requested':
      return 'changes_requested'
    default:
      return 'not_started'
  }
}

export const WORKFLOW_LABEL = {
  pending: 'Pending',
  ready: 'Ready to compile',
  compiled: 'Compiled',
  under_review: 'Under review',
  delivered: 'Delivered to client',
  accepted: 'Accepted',
  changes_requested: 'Changes requested',
}
