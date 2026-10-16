import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, AlertTriangle, Clock, AlertOctagon, CheckCircle2 } from 'lucide-react'
import DocumentExports from '../components/documents/DocumentExports.jsx'
import StatusChip from '../components/StatusChip.jsx'
import SectionsTable from '../components/solutionPackage/SectionsTable.jsx'
import RequiredInputsRegister from '../components/solutionPackage/RequiredInputsRegister.jsx'
import AddressingForm from '../components/solutionPackage/AddressingForm.jsx'
import KvForm from '../components/solutionPackage/KvForm.jsx'
import ValidationResultsTable from '../components/solutionPackage/ValidationResultsTable.jsx'
import AcceptedWarningsTable from '../components/solutionPackage/AcceptedWarningsTable.jsx'
import ResourceEstimatePanel from '../components/solutionPackage/ResourceEstimatePanel.jsx'
import ResourceTasksAction from '../components/tasks/ResourceTasksAction.jsx'
import ShareLinksPanel from '../components/solutionPackage/real/ShareLinksPanel.jsx'
import ChangeRequestsPanel from '../components/solutionPackage/real/ChangeRequestsPanel.jsx'
import { deliveryApi, toRegisterGroups, toWarningRows, toAreaRows, editList } from '../api/deliveryApi.js'
import { validateAddressingEntries } from '@rackium/shared/networkAddressingValidation.js'
import { serialQueue } from '../lib/serialQueue.js'
import { useProjectRoles } from '../lib/useProjectRoles.js'

const PAGES = [
  { id: 1, label: 'Package' },
  { id: 2, label: 'Required Inputs' },
  { id: 3, label: 'Validation & Approval' },
]
const newId = () => Math.random().toString(36).slice(2, 10)
const toVlan = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : '')

function Kpi({ icon: Icon, value, label, tone = 'text-brand' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Icon size={18} strokeWidth={2} className={`shrink-0 ${tone}`} />
      <div className="min-w-0">
        <div className="text-lg font-bold leading-tight text-text">{value}</div>
        <div className="text-[11px] text-text-secondary">{label}</div>
      </div>
    </div>
  )
}

// Real-mode Solution Package (brief v2.3 §5.5; M5a): the prototype's three
// pages on the backend — 18 sections with calculated completeness, the 12
// Required Input groups, validation and approval readiness, the Bill of
// Resources — plus the client share link and change requests.
export default function RealSolutionPackage() {
  const { orgId, projectId, buildingId } = useParams()
  const navigate = useNavigate()
  const { readOnly, has } = useProjectRoles(orgId, projectId)
  const [view, setView] = useState(null)
  const [page, setPage] = useState(1)
  const [selectedGroup, setSelectedGroup] = useState('addressing')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const viewRef = useRef(null)
  const [queue] = useState(serialQueue)

  const reload = useCallback(async () => {
    try {
      const v = await deliveryApi.solutionPackage(orgId, projectId, buildingId)
      viewRef.current = v
      setView(v)
    } catch (err) {
      setError(err.status === 404 ? 'This building is not in the part of the project you can see.' : err.message)
    }
  }, [orgId, projectId, buildingId])
  useEffect(() => {
    reload()
  }, [reload])

  // Package writes carry the latest revision and run one after another.
  const write = (fn, done) =>
    queue(async () => {
      try {
        const res = await fn(viewRef.current.revision)
        setError(null)
        if (done) setNotice(done)
        await reload()
        return res ?? true
      } catch (err) {
        setError(err.message)
        await reload()
        return null
      }
    })

  if (error && !view) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!view) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  const locked = ['awaiting_client', 'approved'].includes(view.state)
  const editable = !readOnly && view.permissions.edit && !locked
  const groups = toRegisterGroups(view.groups)
  const group = groups.find((g) => g.id === selectedGroup) ?? groups[0]
  const saveGroup = (key, body) => write((rev) => deliveryApi.updateGroup(orgId, projectId, key, { buildingId, ...body, baseRevision: rev }))
  // A list edit is applied to the group as it is when the queued save runs.
  const editGroupList = (key, field, op) =>
    write((rev) => {
      const current = viewRef.current.groups.find((g) => g.key === key)?.[field] ?? []
      return deliveryApi.updateGroup(orgId, projectId, key, { buildingId, [field]: editList(current, op), baseRevision: rev })
    })
  const entries = view.groups[0].addressingEntries ?? []
  const basePath = `/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
      <Link to={basePath} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        {view.building.code} dashboard
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text">Solution Package — {view.building.name}</h1>
          <p className="text-sm text-text-secondary">Generated from the validated survey, the approved HLD and LLD and the suggested BOM · revision {view.revision}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={view.status} />
          <DocumentExports
            orgId={orgId}
            projectId={projectId}
            buildingId={buildingId}
            items={[
              { typeKey: 'solution-package', format: 'pdf', label: 'Solution Package' },
              { typeKey: 'solution-package', format: 'docx', label: 'Solution Package' },
              ...(view.permissions.share
                ? [
                    { typeKey: 'solution-package', format: 'pdf', label: 'Client export with prices', options: { prices: 'sell' } },
                    { typeKey: 'solution-package', format: 'docx', label: 'Client export with prices', options: { prices: 'sell' } },
                  ]
                : []),
            ]}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-status-red">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-status-green">
          {notice}
        </p>
      )}
      {locked && (
        <p className="rounded-xl border border-border bg-surface-muted px-3 py-2 text-xs text-text-secondary">
          {view.state === 'approved' ? 'Approved by the client — the HLD and LLD are frozen; changes go through a change request.' : 'With the client for approval — revoke the link to edit the package again.'}
        </p>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {PAGES.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={page === p.id} onClick={() => setPage(p.id)} className={`h-touch shrink-0 px-3 text-sm font-medium sm:h-9 ${page === p.id ? 'border-b-2 border-brand text-brand' : 'text-text-secondary hover:text-text'}`}>
            {p.id}. {p.label}
          </button>
        ))}
      </div>

      {page === 1 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi icon={FileText} value={`${view.packageCompleteness}%`} label="Package completeness" />
            <Kpi icon={FileText} value={view.sections.length} label="Sections generated" />
            <Kpi icon={AlertTriangle} value={view.inputsRequired} label="Inputs required" tone="text-status-amber" />
            <Kpi icon={AlertOctagon} value={view.criticalConflicts} label="Critical findings" tone={view.criticalConflicts > 0 ? 'text-status-red' : 'text-status-green'} />
            <Kpi icon={CheckCircle2} value={view.state === 'approved' ? 'Approved' : 'Draft'} label="Version status" />
          </div>
          <SectionsTable
            sections={view.sections}
            onOpenInputs={(groupKey) => {
              setSelectedGroup(groupKey)
              setPage(2)
            }}
            onOpenBom={() => navigate(`${basePath}/bom`)}
          />
        </>
      )}

      {page === 2 && group && (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi icon={FileText} value={view.totalCount} label="Input groups" />
              <Kpi icon={AlertTriangle} value={view.inputsRequired} label="Inputs required" tone="text-status-amber" />
              <Kpi icon={Clock} value={view.completeCount} label="Completed" tone="text-status-green" />
              <Kpi icon={FileText} value={view.groups.filter((g) => g.ownerId).length} label="Owners assigned" />
            </div>
            <RequiredInputsRegister groups={groups} selectedId={group.id} onSelect={setSelectedGroup} />
          </div>
          <div className="w-full shrink-0 space-y-3 rounded-xl border border-border bg-surface p-4 xl:w-96" data-testid="input-group">
            <div className="text-sm font-semibold text-text">
              {group.n}. {group.name}
            </div>
            {group.id === 'addressing' ? (
              <AddressingForm
                key={`addr-${view.revision}`}
                entries={entries}
                validation={validateAddressingEntries(entries)}
                editable={editable}
                onAdd={() => editGroupList('addressing', 'addressingEntries', { type: 'add', item: { id: newId(), label: '', vlanId: '', cidr: '', gateway: '' } })}
                onUpdate={(entryId, patch) => editGroupList('addressing', 'addressingEntries', { type: 'update', id: entryId, patch: 'vlanId' in patch ? { ...patch, vlanId: toVlan(patch.vlanId) } : patch })}
                onRemove={(entryId) => editGroupList('addressing', 'addressingEntries', { type: 'remove', id: entryId })}
              />
            ) : (
              <KvForm
                key={`kv-${group.id}-${view.revision}`}
                pairs={group.kvPairs ?? []}
                editable={editable}
                onAdd={() => editGroupList(group.id, 'kvPairs', { type: 'add', item: { id: newId(), key: '', value: '' } })}
                onUpdate={(pairId, patch) => editGroupList(group.id, 'kvPairs', { type: 'update', id: pairId, patch })}
                onRemove={(pairId) => editGroupList(group.id, 'kvPairs', { type: 'remove', id: pairId })}
              />
            )}
            <div className="grid grid-cols-1 gap-2 border-t border-border pt-3 sm:grid-cols-2">
              <label className="min-w-0 space-y-1">
                <span className="text-[10px] text-text-secondary">Owner</span>
                <select aria-label="Owner" value={group.ownerId ?? ''} disabled={!editable} onChange={(e) => saveGroup(group.id, { ownerId: e.target.value || null })} className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs focus:border-brand focus:outline-none">
                  <option value="">—</option>
                  {view.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 space-y-1">
                <span className="text-[10px] text-text-secondary">Due date</span>
                <input aria-label="Due date" type="date" key={`due-${group.id}-${group.dueDate}`} defaultValue={group.dueDate ?? ''} disabled={!editable} onBlur={(e) => (e.target.value || null) !== group.dueDate && saveGroup(group.id, { dueDate: e.target.value || null })} className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs focus:border-brand focus:outline-none" />
              </label>
            </div>
          </div>
        </div>
      )}

      {page === 3 && (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Kpi icon={CheckCircle2} value={`${view.completeCount}/${view.totalCount}`} label="Input groups complete" tone="text-status-green" />
              <Kpi icon={FileText} value={`${view.checksPassed}/${view.checksTotal}`} label="Checks passed" />
              <Kpi icon={AlertTriangle} value={view.acceptedWarnings.length} label="Warnings accepted" tone="text-status-amber" />
              <Kpi icon={AlertOctagon} value={view.criticalConflicts} label="Critical findings" tone={view.criticalConflicts > 0 ? 'text-status-red' : 'text-status-green'} />
              <Kpi icon={Clock} value={view.readyForSubmission ? 'Ready' : 'Not ready'} label="Client approval" />
            </div>
            {!view.readyForSubmission && view.blockers.length > 0 && (
              <ul className="list-inside list-disc rounded-xl border border-status-amber/40 bg-status-amber/5 p-3 text-xs text-status-amber" data-testid="readiness-blockers">
                {view.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            <ValidationResultsTable areas={toAreaRows(view.validationAreas)} canAccept={editable} onAccept={(area) => write((rev) => deliveryApi.acceptWarning(orgId, projectId, { buildingId, areaKey: area.key, baseRevision: rev }), `${area.name} accepted`)} />
            <AcceptedWarningsTable warnings={toWarningRows(view.acceptedWarnings)} />
            <ResourceEstimatePanel estimate={view.resourceEstimate} minutesById={view.resourceMinutes} editable={!readOnly && view.permissions.standards} onSetMinutes={(taskId, minutes) => write(() => deliveryApi.setCommercial(orgId, projectId, { resourceMinutes: { [taskId]: minutes } }), 'Standard time saved')} />
            {!readOnly && (has('pm') || has('architect')) && <ResourceTasksAction orgId={orgId} projectId={projectId} buildingId={buildingId} estimate={view.resourceEstimate} />}
          </div>
          <div className="w-full shrink-0 space-y-4 xl:w-96">
            <ShareLinksPanel view={view} canShare={!readOnly && view.permissions.share} orgId={orgId} projectId={projectId} buildingId={buildingId} onChanged={reload} onError={setError} />
          </div>
        </div>
      )}

      <ChangeRequestsPanel orgId={orgId} projectId={projectId} buildingId={buildingId} packageApproved={view.state === 'approved'} canDraft={!readOnly && has('architect')} canSend={!readOnly && view.permissions.share} onError={setError} onChanged={reload} />
    </div>
  )
}
