import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { Plus, Upload, Trash2 } from 'lucide-react'
import { PHASE_KEYS } from '@rackium/shared/phaseCalculations.js'
import { floorHostnameToken, buildHierarchyImportPlan } from '@rackium/shared/hierarchyImport.js'
import { PREDEFINED_WORK_TYPES } from '@rackium/shared/workTypes.js'
import { projectsApi } from '../api/projectsApi.js'
import { hierarchyApi } from '../api/hierarchyApi.js'
import { ApiError } from '../api/httpClient.js'
import { useViewAs } from '../lib/ViewAsContext.jsx'

const PHASE_LABELS = { cmo: 'CMO', survey: 'Survey', hld: 'HLD', lld: 'LLD', 'solution-package': 'Solution Package', bom: 'BOM', deployment: 'Deployment', cmdb: 'CMDB', handover: 'Handover' }
const HIERARCHY_FIELDS = ['countryCode', 'countryName', 'salCode', 'campusCode', 'buildingCode', 'buildingName', 'wingCode', 'wingName']
const emptyRow = () => Object.fromEntries(HIERARCHY_FIELDS.map((f) => [f, '']))
const inputClass = 'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'hierarchy', label: 'Hierarchy' },
  { id: 'phases', label: 'Work types & phases' },
  { id: 'members', label: 'Members & permissions' },
  { id: 'naming', label: 'Naming conventions' },
  { id: 'danger', label: 'Danger zone' },
  { id: 'more', label: 'More' },
]

export default function ProjectSettings() {
  const { orgId, projectId } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'general'
  const { session: viewAsSession } = useViewAs()
  const readOnly = Boolean(viewAsSession)
  const [project, setProject] = useState(null)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    if (!orgId) return
    projectsApi.get(orgId, projectId).then((r) => setProject(r.project))
  }, [orgId, projectId])

  useEffect(() => {
    load()
  }, [load])

  if (!project) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  async function save(body) {
    setError(null)
    setNotice(null)
    try {
      const res = await projectsApi.update(orgId, projectId, body)
      setProject(res.project)
      setNotice('Saved.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.')
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <h1 className="text-lg font-semibold text-text">{project.name} — Settings</h1>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setParams({ tab: t.id })}
            className={`h-9 rounded-t-lg px-3 text-sm font-medium ${tab === t.id ? 'border-b-2 border-brand text-brand' : 'text-text-secondary hover:text-text'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg border border-status-red/40 bg-status-red/5 px-3 py-2 text-sm text-status-red">{error}</p>}
      {notice && <p className="rounded-lg border border-status-green/40 bg-status-green/5 px-3 py-2 text-sm text-status-green">{notice}</p>}

      {tab === 'general' && <GeneralTab project={project} onSave={save} readOnly={readOnly} />}
      {tab === 'hierarchy' && <HierarchyTab orgId={orgId} projectId={projectId} project={project} onImported={load} readOnly={readOnly} />}
      {tab === 'phases' && <PhasesTab project={project} onSave={save} readOnly={readOnly} />}
      {tab === 'members' && <MembersTab />}
      {tab === 'naming' && <NamingTab />}
      {tab === 'danger' && <DangerTab project={project} onSave={save} readOnly={readOnly} />}
      {tab === 'more' && <MoreTab />}
    </div>
  )
}

function GeneralTab({ project, onSave, readOnly }) {
  const [name, setName] = useState(project.name)
  const [clientName, setClientName] = useState(project.clientName ?? '')
  const [description, setDescription] = useState(project.description ?? '')
  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Project name</span>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Client name</span>
        <input className={inputClass} value={clientName} onChange={(e) => setClientName(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Description</span>
        <textarea className={`${inputClass} h-24`} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onSave({ name, clientName, description })}
        className="h-9 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey"
      >
        Save
      </button>
    </div>
  )
}

function HierarchyTab({ orgId, projectId, project, onImported, readOnly }) {
  const [rows, setRows] = useState([emptyRow()])
  const [busy, setBusy] = useState(false)
  const [importError, setImportError] = useState(null)
  const [tree, setTree] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const fileInput = useRef(null)

  const loadTree = useCallback(() => {
    hierarchyApi.tree(orgId, projectId).then((r) => setTree(r.tree))
  }, [orgId, projectId])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  async function deleteCountry(id) {
    setDeleteError(null)
    try {
      await hierarchyApi.countries.remove(orgId, projectId, id)
      loadTree()
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete. Try again.')
    }
  }

  const plan = useMemo(() => {
    const nonEmpty = rows.filter((r) => Object.values(r).some((v) => v.trim()))
    return nonEmpty.length ? buildHierarchyImportPlan(nonEmpty) : { ok: true, buildings: [] }
  }, [rows])

  function updateRow(i, field, value) {
    setRows((current) => current.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }
  async function importFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const workbook = XLSX.read(await file.arrayBuffer())
    const parsed = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' })
    setRows((current) => [...current.filter((r) => Object.values(r).some((v) => v.trim())), ...parsed.map((row) => Object.fromEntries(HIERARCHY_FIELDS.map((f) => [f, String(row[f] ?? '').trim()])))])
    if (fileInput.current) fileInput.current.value = ''
  }

  async function submitImport() {
    if (!plan.ok || plan.buildings.length === 0) return
    setBusy(true)
    setImportError(null)
    try {
      await hierarchyApi.import(orgId, projectId, rows.filter((r) => Object.values(r).some((v) => v.trim())))
      setRows([emptyRow()])
      onImported()
      loadTree()
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Could not import. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-text">Countries ({tree?.countries.length ?? 0})</h2>
        {deleteError && <p className="mb-2 text-xs text-status-red">{deleteError}</p>}
        <ul className="space-y-1">
          {(tree?.countries ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm text-text">
              {c.code} — {c.name}
              <button type="button" disabled={readOnly} onClick={() => deleteCountry(c.id)} className="text-xs font-medium text-status-red hover:underline disabled:cursor-not-allowed disabled:opacity-40">
                Delete
              </button>
            </li>
          ))}
          {tree && tree.countries.length === 0 && <p className="text-xs text-text-secondary">None yet.</p>}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-text">Existing buildings ({project.buildings.length})</h2>
        <ul className="space-y-1">
          {project.buildings.map((b) => (
            <li key={b.id} className="text-sm text-text">
              {b.code} — {b.name}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Add country / SAL / campus / building</h2>
          <div>
            <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={importFile} disabled={readOnly} />
            <button
              type="button"
              disabled={readOnly}
              onClick={() => fileInput.current?.click()}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-text hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Upload size={13} strokeWidth={2} />
              Import file
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-surface-muted text-text-secondary">
              <tr>
                {HIERARCHY_FIELDS.map((f) => (
                  <th key={f} className="px-2 py-1.5 font-medium">
                    {f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {HIERARCHY_FIELDS.map((f) => (
                    <td key={f} className="p-1">
                      <input className="h-8 w-24 rounded border border-border px-1.5 text-xs" value={row[f]} onChange={(e) => updateRow(i, f, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setRows((r) => [...r, emptyRow()])}
          className="mt-2 flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-text hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} strokeWidth={2} />
          Add row
        </button>
        {!plan.ok && <p className="mt-2 text-xs text-status-red">Some rows did not validate.</p>}
        {importError && <p className="mt-2 text-xs text-status-red">{importError}</p>}
        <button
          type="button"
          disabled={readOnly || busy || !plan.ok || plan.buildings.length === 0}
          onClick={submitImport}
          className="mt-3 h-9 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:bg-status-grey"
        >
          Import
        </button>
      </div>
    </div>
  )
}

function PhasesTab({ project, onSave, readOnly }) {
  const [workTypeKeys, setWorkTypeKeys] = useState(project.workTypes.filter((w) => w.isPredefined).map((w) => w.key))
  const [activePhaseKeys, setActivePhaseKeys] = useState(project.activePhases.map((p) => p.phaseKey))

  function togglePhase(key) {
    setActivePhaseKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key].sort((a, b) => PHASE_KEYS.indexOf(a) - PHASE_KEYS.indexOf(b))))
  }
  function toggleWorkType(key) {
    setWorkTypeKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-text">Work types</h2>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {PREDEFINED_WORK_TYPES.map((w) => (
            <label key={w.key} className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={workTypeKeys.includes(w.key)} onChange={() => toggleWorkType(w.key)} />
              {w.name}
            </label>
          ))}
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-text">Active phases</h2>
        <p className="mb-2 text-xs text-text-secondary">A phase that already has data (status or a blocker) cannot be removed.</p>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {PHASE_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={activePhaseKeys.includes(key)} onChange={() => togglePhase(key)} />
              {PHASE_LABELS[key]}
            </label>
          ))}
        </div>
      </div>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onSave({ workTypes: [...PREDEFINED_WORK_TYPES.filter((w) => workTypeKeys.includes(w.key)).map((w) => ({ ...w, isPredefined: true }))], activePhaseKeys })}
        className="h-9 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey"
      >
        Save
      </button>
    </div>
  )
}

function MembersTab() {
  return (
    <p className="text-sm text-text-secondary">
      Members and invitations are managed on the{' '}
      <Link to="/team" className="font-medium text-brand hover:underline">
        Team page
      </Link>
      .
    </p>
  )
}

function NamingTab() {
  const [token, setToken] = useState('1.OG')
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-secondary">Floor tokens are shown as entered; their hostname form strips dots and spaces.</p>
      <label className="block max-w-xs space-y-1">
        <span className="text-xs text-text-secondary">Try a floor token</span>
        <input className={inputClass} value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <p className="text-sm text-text">
        Hostname form: <span className="font-mono font-semibold">{floorHostnameToken(token)}</span>
      </p>
    </div>
  )
}

function DangerTab({ project, onSave, readOnly }) {
  const archived = project.status === 'archived'
  return (
    <div className="space-y-2 rounded-xl border border-status-red/40 bg-status-red/5 p-4">
      <p className="text-sm text-text">{archived ? 'This project is archived.' : 'Archiving hides this project from active lists. It can be reversed.'}</p>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onSave({ status: archived ? 'active' : 'archived' })}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-status-red px-3 text-sm font-medium text-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={14} strokeWidth={2} />
        {archived ? 'Unarchive project' : 'Archive project'}
      </button>
    </div>
  )
}

function MoreTab() {
  return (
    <ul className="space-y-1 text-sm text-text-secondary">
      {['Device roles', 'Connection types', 'Survey templates', 'Validation rules', 'Templates'].map((label) => (
        <li key={label} className="rounded-lg border border-border px-3 py-2">
          {label} — available in a later milestone.
        </li>
      ))}
    </ul>
  )
}
