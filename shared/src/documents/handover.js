// Handover (brief v2.3 §5.9, v2.2 §3.11; M6b): the pre-compilation checklist,
// calculated from every phase, and the workflow states as shown.

// facts: { surveyVerified, hldApproved, lldApproved, spApproved,
//          bom: { approved, lines, undelivered }, deployment: { planned, accepted },
//          cmdb: { designCount, cmdbCount }, exceptions: { open, rejectedUncorrected } }
export function handoverChecklist(f) {
  const item = (id, label, ok, detail) => ({ id, label, ok: Boolean(ok), detail })
  return [
    item('survey', 'Survey: every tab verified', f.surveyVerified, f.surveyVerified ? 'Verified' : 'Not yet verified'),
    item('hld', 'HLD: approved', f.hldApproved, f.hldApproved ? 'Approved' : 'Not yet approved'),
    item('lld', 'LLD: approved and frozen', f.lldApproved, f.lldApproved ? 'Frozen by the Solution Package approval' : 'Not yet approved'),
    item('solution-package', 'Solution Package: approved by the client', f.spApproved, f.spApproved ? 'Approved' : 'Not yet approved'),
    item('bom', 'BOM: approved and every line delivered', f.bom.approved && f.bom.undelivered === 0, !f.bom.approved ? 'Procurement BOM not approved' : f.bom.undelivered ? `${f.bom.undelivered} of ${f.bom.lines} line(s) not yet Delivered` : 'All delivered'),
    item('deployment', 'Deployment: every device accepted', f.deployment.planned > 0 && f.deployment.accepted >= f.deployment.planned, f.deployment.planned === 0 ? 'Nothing to deploy yet' : `${f.deployment.accepted} of ${f.deployment.planned} device(s) accepted`),
    item('cmdb', 'CMDB: complete', f.cmdb.designCount > 0 && f.cmdb.cmdbCount >= f.cmdb.designCount, `${f.cmdb.cmdbCount} of ${f.cmdb.designCount} record(s)`),
    item('exceptions', 'Exceptions: resolved or documented', f.exceptions.open === 0 && (f.exceptions.rejectedUncorrected ?? 0) === 0, f.exceptions.open ? `${f.exceptions.open} open exception(s)` : f.exceptions.rejectedUncorrected ? `${f.exceptions.rejectedUncorrected} rejected exception(s) not corrected` : 'None open'),
  ]
}
export const checklistReady = (items) => items.every((i) => i.ok)

// Stored state → shown state: "Ready" is pending with the checklist green.
export const HANDOVER_STATES = ['pending', 'ready', 'compiling', 'compiled', 'under_review', 'delivered', 'changes_requested', 'accepted']
export const HANDOVER_STATE_LABELS = { pending: 'Pending', ready: 'Ready', compiling: 'Compiling', compiled: 'Compiled', under_review: 'Under review', delivered: 'Delivered', changes_requested: 'Changes requested', accepted: 'Accepted' }
export const shownState = (state, ready) => (state === 'pending' && ready ? 'ready' : state)

// What may happen next, and who does it.
export function handoverActionProblem(action, { state, ready, roles = [] }) {
  const pm = roles.includes('pm')
  switch (action) {
    case 'compile':
      if (!pm) return 'Only a PM compiles the handover package'
      if (!['pending', 'compiled', 'under_review', 'changes_requested', 'compiling'].includes(state)) return `The package cannot be compiled while it is ${HANDOVER_STATE_LABELS[state]}`
      if (!ready) return 'The pre-compilation checklist is not complete'
      return null
    case 'review':
      if (!roles.some((r) => ['pm', 'reviewer'].includes(r))) return 'Only a PM or Reviewer marks the package reviewed'
      return state === 'compiled' ? null : 'Compile the package before it is reviewed'
    case 'deliver':
      if (!pm) return 'Only a PM sends the package to the client'
      return state === 'under_review' ? null : 'The package is sent once it has been reviewed'
    default:
      return 'Unknown action'
  }
}

// Handover phase status on the dashboard, sidebar and project list.
export function handoverPhaseStatus(state) {
  if (!state) return 'not_started'
  return { pending: 'in_progress', compiling: 'in_progress', compiled: 'in_progress', under_review: 'in_progress', delivered: 'awaiting_approval', changes_requested: 'changes_requested', accepted: 'approved' }[state] ?? 'in_progress'
}
