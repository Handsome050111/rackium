import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Download, FileText, AlertTriangle, Clock, AlertOctagon, CheckCircle2 } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import StatusChip from '../components/StatusChip.jsx'
import SectionsTable from '../components/solutionPackage/SectionsTable.jsx'
import RequiredInputsRegister from '../components/solutionPackage/RequiredInputsRegister.jsx'
import AddressingForm from '../components/solutionPackage/AddressingForm.jsx'
import KvForm from '../components/solutionPackage/KvForm.jsx'
import ValidationResultsTable from '../components/solutionPackage/ValidationResultsTable.jsx'
import AcceptedWarningsTable from '../components/solutionPackage/AcceptedWarningsTable.jsx'
import ShareLinkPanel from '../components/solutionPackage/ShareLinkPanel.jsx'
import ResourceEstimatePanel from '../components/solutionPackage/ResourceEstimatePanel.jsx'
import { getBuilding } from '../api/index.js'
import { getSolutionPackageContext, submitForClientApproval, acceptWarning, getAcceptedWarnings } from '../api/solutionPackageDesign.js'
import {
  addAddressingEntry,
  updateAddressingEntry,
  removeAddressingEntry,
  setGroupMeta,
  addKvPair,
  updateKvPair,
  removeKvPair,
} from '../api/requiredInputsStore.js'
import { setResourceMinutes } from '../api/projectSettings.js'
import { useRole } from '../lib/RoleContext.jsx'
import { canEditSolutionPackage, canSubmitSolutionPackageForApproval } from '../lib/permissions.js'

const PAGES = [
  { id: 1, label: 'Package' },
  { id: 2, label: 'Required Inputs' },
  { id: 3, label: 'Validation & Approval' },
]

function Kpi({ icon: Icon, value, label, tone = 'text-brand' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Icon size={18} strokeWidth={2} className={`shrink-0 ${tone}`} />
      <div>
        <div className="text-lg font-bold leading-tight text-text">{value}</div>
        <div className="text-[11px] text-text-secondary">{label}</div>
      </div>
    </div>
  )
}

export default function SolutionPackage() {
  const { buildingId } = useParams()
  const navigate = useNavigate()
  const { role } = useRole()
  const [building, setBuilding] = useState(null)
  const [context, setContext] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [page, setPage] = useState(1)
  const [selectedGroupId, setSelectedGroupId] = useState('addressing')

  const reload = useCallback(() => {
    if (!buildingId) return
    Promise.all([getSolutionPackageContext(buildingId), getAcceptedWarnings(buildingId)]).then(([ctx, w]) => {
      setContext(ctx)
      setWarnings(w)
    })
  }, [buildingId])

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
  }, [buildingId])

  useEffect(() => {
    reload()
  }, [reload])

  function openInputs(groupId) {
    setSelectedGroupId(groupId)
    setPage(2)
  }

  const editable = canEditSolutionPackage(role)
  const canSubmit = canSubmitSolutionPackageForApproval(role)

  async function handleAddEntry() {
    await addAddressingEntry(buildingId, {})
    reload()
  }
  async function handleUpdateEntry(id, patch) {
    await updateAddressingEntry(buildingId, id, patch)
    reload()
  }
  async function handleRemoveEntry(id) {
    await removeAddressingEntry(buildingId, id)
    reload()
  }
  async function handleGroupMeta(groupId, meta) {
    await setGroupMeta(buildingId, groupId, meta)
    reload()
  }
  async function handleAddKv(groupId) {
    await addKvPair(buildingId, groupId)
    reload()
  }
  async function handleUpdateKv(groupId, id, patch) {
    await updateKvPair(buildingId, groupId, id, patch)
    reload()
  }
  async function handleRemoveKv(groupId, id) {
    await removeKvPair(buildingId, groupId, id)
    reload()
  }
  async function handleAcceptWarning(area) {
    await acceptWarning(buildingId, area.id, `${area.name}: ${area.description}`, role)
    reload()
  }
  async function handleSubmit({ password, expiryDays }) {
    await submitForClientApproval(buildingId, { password, expiryDays })
    reload()
  }
  async function handleSetMinutes(taskId, minutes) {
    await setResourceMinutes(taskId, minutes)
    reload()
  }

  if (!building || !context) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const selectedGroup = context.requiredInputs.groups.find((g) => g.id === selectedGroupId)

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
      <Breadcrumb items={[...building.breadcrumb, { label: 'Solution Package' }, ...(page > 1 ? [{ label: PAGES.find((p) => p.id === page).label }] : [])]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Solution Package — {building.name}</h1>
          <p className="text-sm text-text-secondary">NexAI-generated from validated survey, finalised HLD, adjusted LLD and suggested BOM</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={context.status} />
          <button
            type="button"
            disabled
            title="Available with document engine"
            className="h-touch rounded-lg border border-border px-3 text-xs font-medium text-text-secondary disabled:cursor-not-allowed sm:h-9"
          >
            Export PDF
          </button>
          <button
            type="button"
            disabled
            title="Available with document engine"
            className="h-touch rounded-lg border border-border px-3 text-xs font-medium text-text-secondary disabled:cursor-not-allowed sm:h-9"
          >
            <Download size={14} strokeWidth={2} className="mr-1 inline" />
            Export Word
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPage(p.id)}
            className={`h-touch px-3 text-sm font-medium sm:h-9 ${page === p.id ? 'border-b-2 border-brand text-brand' : 'text-text-secondary hover:text-text'}`}
          >
            {p.id}. {p.label}
          </button>
        ))}
      </div>

      {page === 1 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi icon={FileText} value={`${context.packageCompleteness}%`} label="Package completeness" />
            <Kpi icon={FileText} value={context.sections.length} label="Sections generated" />
            <Kpi icon={AlertTriangle} value={context.inputsRequired} label="Inputs required" tone="text-status-amber" />
            <Kpi icon={AlertOctagon} value={context.criticalConflicts} label="Design conflicts" tone={context.criticalConflicts > 0 ? 'text-status-red' : 'text-status-green'} />
            <Kpi icon={CheckCircle2} value={context.status === 'approved' ? 'Approved' : 'Draft'} label="Version status" />
          </div>
          <SectionsTable sections={context.sections} onOpenInputs={openInputs} onOpenBom={() => navigate(`/b/${buildingId}/bom`)} />
        </>
      )}

      {page === 2 && (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi icon={FileText} value={context.requiredInputs.totalCount} label="Input groups" />
              <Kpi icon={AlertTriangle} value={context.inputsRequired} label="Inputs required" tone="text-status-amber" />
              <Kpi icon={Clock} value={context.requiredInputs.completeCount} label="Completed" tone="text-status-green" />
              <Kpi icon={FileText} value={context.requiredInputs.groups.filter((g) => g.owner).length} label="Owners assigned" />
            </div>
            <RequiredInputsRegister groups={context.requiredInputs.groups} selectedId={selectedGroupId} onSelect={setSelectedGroupId} />
          </div>

          {selectedGroup && (
            <div className="w-full shrink-0 space-y-3 rounded-xl border border-border bg-surface p-4 xl:w-96">
              <div className="text-sm font-semibold text-text">
                {selectedGroup.n}. {selectedGroup.name}
              </div>

              {selectedGroup.id === 'addressing' ? (
                <AddressingForm
                  entries={context.requiredInputs.addressingEntries}
                  validation={context.requiredInputs.addressingValidation}
                  editable={editable}
                  onAdd={handleAddEntry}
                  onUpdate={handleUpdateEntry}
                  onRemove={handleRemoveEntry}
                />
              ) : (
                <KvForm
                  pairs={selectedGroup.kvPairs ?? []}
                  editable={editable}
                  onAdd={() => handleAddKv(selectedGroup.id)}
                  onUpdate={(id, patch) => handleUpdateKv(selectedGroup.id, id, patch)}
                  onRemove={(id) => handleRemoveKv(selectedGroup.id, id)}
                />
              )}

              <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
                <label className="space-y-1">
                  <span className="text-[10px] text-text-secondary">Owner</span>
                  <input
                    defaultValue={selectedGroup.owner ?? ''}
                    disabled={!editable}
                    onBlur={(e) => handleGroupMeta(selectedGroup.id, { owner: e.target.value })}
                    className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs focus:border-brand focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-text-secondary">Due date</span>
                  <input
                    type="date"
                    defaultValue={selectedGroup.dueDate ?? ''}
                    disabled={!editable}
                    onBlur={(e) => handleGroupMeta(selectedGroup.id, { dueDate: e.target.value })}
                    className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs focus:border-brand focus:outline-none"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {page === 3 && (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Kpi icon={CheckCircle2} value={`${context.requiredInputs.allComplete ? 100 : context.packageCompleteness}%`} label="Mandatory inputs" tone="text-status-green" />
              <Kpi icon={FileText} value={`${context.checksPassed}/${context.checksTotal}`} label="Checks passed" />
              <Kpi icon={AlertTriangle} value={warnings.length} label="Warnings accepted" tone="text-status-amber" />
              <Kpi icon={AlertOctagon} value={context.criticalConflicts} label="Critical conflicts" tone={context.criticalConflicts > 0 ? 'text-status-red' : 'text-status-green'} />
              <Kpi icon={Clock} value={context.readyForSubmission ? 'Ready' : 'Not ready'} label="Client approval" />
            </div>
            <ValidationResultsTable areas={context.validationAreas} onAccept={handleAcceptWarning} canAccept={editable} />
            <AcceptedWarningsTable warnings={warnings} />
            <ResourceEstimatePanel estimate={context.resourceEstimate} minutesById={context.resourceMinutes} editable={editable} onSetMinutes={handleSetMinutes} />
          </div>
          <div className="w-full shrink-0 xl:w-80">
            <ShareLinkPanel activeLink={context.activeLink} readyForSubmission={context.readyForSubmission} canSubmit={canSubmit} onSubmit={handleSubmit} />
          </div>
        </div>
      )}
    </div>
  )
}
