import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { Plus, Upload, Trash2, AlertTriangle } from 'lucide-react'
import { PREDEFINED_WORK_TYPES } from '@rackium/shared/workTypes.js'
import { PHASE_KEYS } from '@rackium/shared/phaseCalculations.js'
import { PRESETS } from '@rackium/shared/phaseGating.js'
import { buildHierarchyImportPlan } from '@rackium/shared/hierarchyImport.js'
import { PROJECT_ROLES, ROLE_LABELS } from '@rackium/shared/policy.js'
import { projectsApi } from '../api/projectsApi.js'
import { ApiError } from '../api/httpClient.js'

const STEPS = ['Identity & scope', 'Structure', 'Team']
const PHASE_LABELS = { cmo: 'CMO', survey: 'Survey', hld: 'HLD', lld: 'LLD', 'solution-package': 'Solution Package', bom: 'BOM', deployment: 'Deployment', cmdb: 'CMDB', handover: 'Handover' }
const HIERARCHY_FIELDS = ['countryCode', 'countryName', 'salCode', 'campusCode', 'buildingCode', 'buildingName', 'wingCode', 'wingName']
const emptyRow = () => Object.fromEntries(HIERARCHY_FIELDS.map((f) => [f, '']))

const inputClass = 'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

export default function ProjectWizard() {
  const { orgId } = useParams()
  const navigate = useNavigate()
  const fileInput = useRef(null)

  const [step, setStep] = useState(0)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Step 1
  const [name, setName] = useState('')
  const [clientName, setClientName] = useState('')
  const [description, setDescription] = useState('')
  const [code, setCode] = useState('')
  const [workTypeKeys, setWorkTypeKeys] = useState([])
  const [customWorkTypes, setCustomWorkTypes] = useState([])
  const [customWorkTypeInput, setCustomWorkTypeInput] = useState('')
  const [activePhaseKeys, setActivePhaseKeys] = useState(PHASE_KEYS)

  // Step 2
  const [rows, setRows] = useState([emptyRow()])

  // Step 3
  const [team, setTeam] = useState([])
  const [teamDraft, setTeamDraft] = useState({ email: '', role: 'architect' })

  const plan = useMemo(() => {
    const nonEmpty = rows.filter((r) => Object.values(r).some((v) => v.trim()))
    if (nonEmpty.length === 0) return { ok: true, countries: [], sals: [], campuses: [], buildings: [], wings: [] }
    return buildHierarchyImportPlan(nonEmpty)
  }, [rows])

  function toggleWorkType(key) {
    setWorkTypeKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
  }
  function addCustomWorkType() {
    const trimmed = customWorkTypeInput.trim()
    if (!trimmed) return
    setCustomWorkTypes((list) => [...list, trimmed])
    setCustomWorkTypeInput('')
  }
  function togglePhase(key) {
    setActivePhaseKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key].sort((a, b) => PHASE_KEYS.indexOf(a) - PHASE_KEYS.indexOf(b))))
  }

  function updateRow(index, field, value) {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }
  function addRow() {
    setRows((current) => [...current, emptyRow()])
  }
  function removeRow(index) {
    setRows((current) => current.filter((_, i) => i !== index))
  }
  async function importFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const data = await file.arrayBuffer()
    const workbook = XLSX.read(data)
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    const imported = parsed.map((row) => Object.fromEntries(HIERARCHY_FIELDS.map((f) => [f, String(row[f] ?? '').trim()])))
    setRows((current) => [...current.filter((r) => Object.values(r).some((v) => v.trim())), ...imported])
    if (fileInput.current) fileInput.current.value = ''
  }

  function addTeamMember() {
    if (!teamDraft.email.trim()) return
    setTeam((list) => [...list, { email: teamDraft.email.trim(), role: teamDraft.role, scopes: [] }])
    setTeamDraft({ email: '', role: 'architect' })
  }
  function removeTeamMember(index) {
    setTeam((list) => list.filter((_, i) => i !== index))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const workTypes = [
        ...PREDEFINED_WORK_TYPES.filter((w) => workTypeKeys.includes(w.key)).map((w) => ({ ...w, isPredefined: true })),
        ...customWorkTypes.map((name) => ({ key: name.toLowerCase().replace(/\s+/g, '_'), name, isPredefined: false })),
      ]
      const res = await projectsApi.create(orgId, {
        name,
        code: code || undefined,
        clientName: clientName || undefined,
        description: description || undefined,
        workTypes,
        activePhaseKeys,
        hierarchy: { countries: plan.countries ?? [], sals: plan.sals ?? [], campuses: plan.campuses ?? [], buildings: plan.buildings ?? [], wings: plan.wings ?? [] },
        team,
      })
      navigate(`/orgs/${orgId}/projects/${res.project.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the project. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const step1Valid = name.trim().length > 0 && activePhaseKeys.length > 0
  const step2Valid = plan.ok

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <h1 className="text-lg font-semibold text-text">New project</h1>

      <div className="flex items-center gap-2 text-xs text-text-secondary">
        {STEPS.map((label, i) => (
          <span key={label} className={`flex items-center gap-1.5 ${i === step ? 'font-semibold text-brand' : ''}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${i === step ? 'border-brand text-brand' : 'border-border'}`}>{i + 1}</span>
            {label}
            {i < STEPS.length - 1 && <span className="mx-1 text-border">—</span>}
          </span>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-status-red/40 bg-status-red/5 px-3 py-2.5 text-sm text-status-red">
          <AlertTriangle size={15} strokeWidth={2} className="shrink-0" />
          {error}
        </div>
      )}

      {step === 0 && (
        <div className="space-y-4">
          <Field label="Project name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Client name">
              <input className={inputClass} value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </Field>
            <Field label="Code (optional)">
              <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          </div>
          <Field label="Description">
            <textarea className={`${inputClass} h-20`} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <div>
            <span className="text-xs text-text-secondary">Work types</span>
            <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {PREDEFINED_WORK_TYPES.map((w) => (
                <label key={w.key} className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={workTypeKeys.includes(w.key)} onChange={() => toggleWorkType(w.key)} />
                  {w.name}
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {customWorkTypes.map((name) => (
                <span key={name} className="rounded-full border border-border px-2 py-0.5 text-xs text-text">
                  {name}
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input className={inputClass} placeholder="Custom work type" value={customWorkTypeInput} onChange={(e) => setCustomWorkTypeInput(e.target.value)} />
              <button type="button" onClick={addCustomWorkType} className="h-9 rounded-lg border border-border px-3 text-sm font-medium text-text hover:border-brand">
                Add
              </button>
            </div>
          </div>

          <div>
            <span className="text-xs text-text-secondary">Active phases</span>
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" onClick={() => setActivePhaseKeys(PRESETS.full_network_deployment)} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text hover:border-brand">
                Full Network Deployment
              </button>
              <button type="button" onClick={() => setActivePhaseKeys(PRESETS.survey_and_design_only)} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text hover:border-brand">
                Survey &amp; Design Only
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
              {PHASE_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={activePhaseKeys.includes(key)} onChange={() => togglePhase(key)} />
                  {PHASE_LABELS[key]}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">Country, SAL, campus and building — one row per building. Add rows manually, or import a CSV/Excel file with the same columns.</p>
            <div>
              <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={importFile} />
              <button type="button" onClick={() => fileInput.current?.click()} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-text hover:border-brand">
                <Upload size={14} strokeWidth={2} />
                Import file
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-surface-muted text-text-secondary">
                <tr>
                  {HIERARCHY_FIELDS.map((f) => (
                    <th key={f} className="px-2 py-1.5 font-medium">
                      {f}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    {HIERARCHY_FIELDS.map((f) => (
                      <td key={f} className="p-1">
                        <input className="h-8 w-28 rounded border border-border px-1.5 text-xs" value={row[f]} onChange={(e) => updateRow(i, f, e.target.value)} />
                      </td>
                    ))}
                    <td className="p-1">
                      <button type="button" onClick={() => removeRow(i)} aria-label="Remove row" className="text-status-red">
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addRow} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-text hover:border-brand">
            <Plus size={12} strokeWidth={2} />
            Add row
          </button>

          {!plan.ok && (
            <div className="rounded-lg border border-status-red/40 bg-status-red/5 p-3 text-xs text-status-red">
              {plan.rowErrors.map((re, i) => (
                <div key={i}>
                  Row {re.index + 1}: {re.errors.map((e) => e.message).join('; ')}
                </div>
              ))}
            </div>
          )}
          {plan.ok && plan.buildings.length > 0 && (
            <p className="text-xs text-status-green">
              {plan.countries.length} countr{plan.countries.length === 1 ? 'y' : 'ies'}, {plan.sals.length} SAL{plan.sals.length === 1 ? '' : 's'}, {plan.campuses.length} campus
              {plan.campuses.length === 1 ? '' : 'es'}, {plan.buildings.length} building{plan.buildings.length === 1 ? '' : 's'} ready to create.
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">Invite people now, or skip and invite them later from Project Settings. You become this project's PM automatically.</p>
          <div className="flex flex-wrap gap-2">
            <input className={`${inputClass} max-w-xs`} placeholder="Email" value={teamDraft.email} onChange={(e) => setTeamDraft((d) => ({ ...d, email: e.target.value }))} />
            <select className={`${inputClass} max-w-[160px]`} value={teamDraft.role} onChange={(e) => setTeamDraft((d) => ({ ...d, role: e.target.value }))}>
              {PROJECT_ROLES.filter((r) => r !== 'pm').map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button type="button" onClick={addTeamMember} className="h-9 rounded-lg border border-border px-3 text-sm font-medium text-text hover:border-brand">
              Add
            </button>
          </div>
          <ul className="space-y-1.5">
            {team.map((member, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>
                  {member.email} <span className="text-text-secondary">· {ROLE_LABELS[member.role]}</span>
                </span>
                <button type="button" onClick={() => removeTeamMember(i)} aria-label={`Remove ${member.email}`} className="text-status-red">
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <button type="button" disabled={step === 0} onClick={() => setStep((s) => s - 1)} className="h-9 rounded-lg border border-border px-4 text-sm font-medium text-text disabled:opacity-40">
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            disabled={(step === 0 && !step1Valid) || (step === 1 && !step2Valid)}
            onClick={() => setStep((s) => s + 1)}
            className="h-9 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey"
          >
            Next
          </button>
        ) : (
          <button type="button" disabled={submitting} onClick={handleSubmit} className="h-9 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:bg-status-grey">
            {submitting ? 'Creating…' : 'Create project'}
          </button>
        )}
      </div>
    </div>
  )
}
