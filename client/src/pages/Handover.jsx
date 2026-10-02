import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PackageCheck, Lock, PlayCircle, Eye } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import WorkflowTracker from '../components/handover/WorkflowTracker.jsx'
import ChecklistPanel from '../components/handover/ChecklistPanel.jsx'
import DocumentList from '../components/handover/DocumentList.jsx'
import ShareLinkPanel from '../components/solutionPackage/ShareLinkPanel.jsx'
import { getBuilding } from '../api/index.js'
import { getHandoverContext, compilePackage, markUnderReview, sendToClient } from '../api/handoverDesign.js'
import { getLldContext } from '../api/lldDesign.js'
import { getBomContext } from '../api/bomDesign.js'
import { getCmdbContext } from '../api/cmdbDesign.js'
import { exportCableScheduleXlsx } from '../lib/lldExport.js'
import { exportBomXlsx } from '../lib/bomExport.js'
import { exportCmdbCsv } from '../lib/cmdbExport.js'
import { useRole } from '../lib/RoleContext.jsx'
import { canManageHandover } from '../lib/permissions.js'

const EXPORTERS = {
  'cable-matrix': async (buildingId, building) => {
    const ctx = await getLldContext(buildingId)
    await exportCableScheduleXlsx(ctx.rows, `${building.code}-cable-matrix.xlsx`)
  },
  'bom-final': async (buildingId, building) => {
    const ctx = await getBomContext(buildingId)
    await exportBomXlsx(ctx.lines, `${building.code}-bom-final.xlsx`)
  },
  'cmdb-extract': async (buildingId, building) => {
    const ctx = await getCmdbContext(buildingId)
    await exportCmdbCsv(ctx.rows, `${building.code}-cmdb-extract.csv`)
  },
}

export default function Handover() {
  const { buildingId } = useParams()
  const { role } = useRole()
  const [building, setBuilding] = useState(null)
  const [context, setContext] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(() => {
    if (!buildingId) return
    getHandoverContext(buildingId).then(setContext)
  }, [buildingId])

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
  }, [buildingId])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleCompile() {
    const result = await compilePackage(buildingId)
    if (!result.ok) return setError(result.error)
    setError(null)
    reload()
  }

  async function handleMarkReviewed() {
    const result = await markUnderReview(buildingId)
    if (!result.ok) return setError(result.error)
    setError(null)
    reload()
  }

  async function handleSendToClient(args) {
    await sendToClient(buildingId, args)
    reload()
  }

  async function handleExport(docId) {
    const exporter = EXPORTERS[docId]
    if (exporter) await exporter(buildingId, building)
  }

  if (!building || !context) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const manage = canManageHandover(role)

  return (
    <div className="mx-auto max-w-[1300px] space-y-4 p-4 sm:p-6">
      <Breadcrumb items={[...building.breadcrumb, { label: 'Handover' }]} />

      <div className="flex items-center gap-2">
        <PackageCheck size={22} strokeWidth={2} className="text-brand" />
        <div>
          <h1 className="text-2xl font-bold text-text">Handover — {building.name}</h1>
          <p className="text-sm text-text-secondary">Formal wrapper around the CMDB — compiles the full project record into a client deliverable</p>
        </div>
      </div>

      {context.baseline && (
        <div className="flex items-center gap-2 rounded-xl border border-status-green/40 bg-status-green/5 px-4 py-3 text-sm text-status-green">
          <Lock size={16} strokeWidth={2} />
          <div>
            <strong>Handover Approved</strong> — baseline {context.baseline.versionLabel} frozen {new Date(context.baseline.frozenAt).toLocaleString()}. This building's design
            record is now permanently read-only.
          </div>
        </div>
      )}

      <WorkflowTracker state={context.workflowState} readyToCompile={context.readyToCompile} />

      {error && <p className="text-xs text-status-red">{error}</p>}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <ChecklistPanel checklist={context.checklist} />
          <DocumentList documents={context.documents} onExport={handleExport} />
        </div>

        <div className="w-full shrink-0 space-y-4 lg:w-80">
          {manage && (context.workflowState === 'pending' || context.workflowState === 'changes_requested') && (
            <button
              type="button"
              disabled={!context.readyToCompile}
              onClick={handleCompile}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-brand text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey"
            >
              <PlayCircle size={14} strokeWidth={2} />
              Compile package
            </button>
          )}
          {!context.readyToCompile && (context.workflowState === 'pending' || context.workflowState === 'changes_requested') && (
            <p className="text-xs text-status-amber">Resolve the checklist items above before compiling.</p>
          )}

          {manage && context.workflowState === 'compiled' && (
            <button
              type="button"
              onClick={handleMarkReviewed}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-brand text-xs font-medium text-white hover:bg-brand/90"
            >
              <Eye size={14} strokeWidth={2} />
              Mark reviewed
            </button>
          )}

          {(context.workflowState === 'under_review' || context.workflowState === 'delivered' || context.workflowState === 'accepted') && (
            <ShareLinkPanel
              activeLink={context.activeLink}
              readyForSubmission={context.workflowState === 'under_review'}
              canSubmit={manage}
              onSubmit={handleSendToClient}
              title="Client sign-off link"
              actionLabel="Send to Client"
              notReadyHint="Mark the package reviewed before sending it to the client."
            />
          )}

          {context.decision && (
            <div className="space-y-1 rounded-xl border border-border bg-surface p-4 text-xs">
              <div className="font-semibold text-text">Client decision</div>
              <div className="text-text-secondary">
                {context.decision.decision} by {context.decision.name}
                {context.decision.role ? ` (${context.decision.role})` : ''}
              </div>
              <div className="text-text-secondary">{new Date(context.decision.acceptedAt).toLocaleString()}</div>
              {context.decision.comments && <div className="text-text">"{context.decision.comments}"</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
