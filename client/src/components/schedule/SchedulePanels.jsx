import { useEffect, useMemo, useState } from 'react'
import { Trash2, Check, Undo2 } from 'lucide-react'
import { PHASE_LABELS } from '@rackium/shared/notifications.js'
import { STANDARD_MILESTONES } from '@rackium/shared/schedule.js'
import { scheduleApi } from '../../api/scheduleApi.js'
import { reportSchedulesApi } from '../../api/insightsApi.js'
import { tasksApi } from '../../api/workApi.js'
import { SlaBadge } from './Badges.jsx'
import BurndownChart from './BurndownChart.jsx'

export const inputClass = 'h-9 min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none disabled:opacity-60'
const btn = 'h-9 rounded-lg px-3 text-xs font-medium disabled:opacity-50'
const primary = `${btn} bg-brand text-white`
const secondary = `${btn} border border-border text-text hover:bg-surface-muted`
const iconBtn = 'flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted hover:text-text'

export function Panel({ title, children, actions, testId }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

const codeOf = (view, id) => view.buildings.find((b) => b.id === id)?.code ?? '—'

// Targets per building (the keyboard alternative to dragging) and the
// building's primary Architect and Field Engineer (v2.2 §21.5).
export function TargetsPanel({ view, orgId, projectId, canEdit, buildingId, onBuilding, run }) {
  const bars = useMemo(() => view.bars.filter((b) => b.buildingId === buildingId), [view.bars, buildingId])
  const [draft, setDraft] = useState({})
  const [people, setPeople] = useState([])
  const building = view.buildings.find((b) => b.id === buildingId)
  const [assignees, setAssignees] = useState({ primaryArchitectId: '', primaryFieldEngineerId: '' })
  useEffect(() => {
    setDraft(Object.fromEntries(bars.map((b) => [b.phaseKey, { startDate: b.startDate ?? '', targetDate: b.target ?? '' }])))
  }, [bars])
  useEffect(() => {
    setAssignees({ primaryArchitectId: building?.primaryArchitectId ?? '', primaryFieldEngineerId: building?.primaryFieldEngineerId ?? '' })
    if (!buildingId) return
    tasksApi
      .assignees(orgId, projectId, buildingId)
      .then((r) => setPeople(r.assignees))
      .catch(() => setPeople([]))
  }, [orgId, projectId, buildingId, building?.primaryArchitectId, building?.primaryFieldEngineerId])

  const changed = bars.filter((b) => {
    const d = draft[b.phaseKey]
    return d && ((d.startDate || null) !== (b.startDate ?? null) || (d.targetDate || null) !== (b.target ?? null))
  })
  // A target is the PM's: the computed start (the previous target) is only shown.
  const invalid = changed.find((b) => draft[b.phaseKey].startDate && draft[b.phaseKey].targetDate && draft[b.phaseKey].startDate > draft[b.phaseKey].targetDate)
  async function save() {
    await run(() => scheduleApi.setTargets(orgId, projectId, changed.map((b) => ({ buildingId, phaseKey: b.phaseKey, startDate: draft[b.phaseKey].startDate || null, targetDate: draft[b.phaseKey].targetDate || null }))), `Saved ${changed.length} target${changed.length === 1 ? '' : 's'} for ${building?.code}`)
  }
  const architects = people.filter((p) => p.roles.includes('architect'))
  const engineers = people.filter((p) => p.roles.includes('field_engineer'))
  const nameOf = (id) => people.find((p) => p.userId === id)?.name ?? (id ? 'Someone outside your view' : 'Not set')

  return (
    <Panel
      title="Targets"
      testId="targets-panel"
      actions={
        <select aria-label="Building" value={buildingId ?? ''} onChange={(e) => onBuilding(e.target.value)} className={inputClass}>
          {view.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </select>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="text-left text-text-secondary">
            <tr>
              <th className="py-1 pr-2 font-medium">Phase</th>
              <th className="py-1 pr-2 font-medium">Start (optional)</th>
              <th className="py-1 pr-2 font-medium">Target</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.phaseKey} className="border-t border-border/60">
                <td className="py-1.5 pr-2 font-medium text-text">{PHASE_LABELS[b.phaseKey]}</td>
                <td className="py-1.5 pr-2">
                  <input type="date" aria-label={`${PHASE_LABELS[b.phaseKey]} start`} disabled={!canEdit} value={draft[b.phaseKey]?.startDate ?? ''} placeholder={b.start ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [b.phaseKey]: { ...d[b.phaseKey], startDate: e.target.value } }))} className={inputClass} />
                  {!draft[b.phaseKey]?.startDate && b.start && <span className="ml-2 text-[11px] text-text-secondary">from {b.start}</span>}
                </td>
                <td className="py-1.5 pr-2">
                  <input type="date" aria-label={`${PHASE_LABELS[b.phaseKey]} target`} disabled={!canEdit} value={draft[b.phaseKey]?.targetDate ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [b.phaseKey]: { ...d[b.phaseKey], targetDate: e.target.value } }))} className={inputClass} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invalid && <p className="mt-2 text-xs text-status-red">{PHASE_LABELS[invalid.phaseKey]}: the start is after the target.</p>}
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <button type="button" className={primary} disabled={!changed.length || Boolean(invalid)} onClick={save}>
            Save targets
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
        {[
          ['primaryArchitectId', 'Primary Network Architect', architects],
          ['primaryFieldEngineerId', 'Primary Field Engineer', engineers],
        ].map(([field, label, options]) => (
          <label key={field} className="flex flex-col gap-1 text-xs">
            <span className="text-text-secondary">{label}</span>
            {canEdit ? (
              <select
                aria-label={label}
                value={assignees[field]}
                onChange={async (e) => {
                  const value = e.target.value
                  setAssignees((a) => ({ ...a, [field]: value }))
                  await run(() => scheduleApi.setAssignees(orgId, projectId, buildingId, { [field]: value || null }), `${label}: ${value ? nameOf(value) : 'cleared'}`)
                }}
                className={inputClass}
              >
                <option value="">Not set</option>
                {options.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                  </option>
                ))}
                {assignees[field] && !options.some((p) => p.userId === assignees[field]) && <option value={assignees[field]}>{nameOf(assignees[field])}</option>}
              </select>
            ) : (
              <span className="text-text">{nameOf(assignees[field])}</span>
            )}
          </label>
        ))}
      </div>
    </Panel>
  )
}

// Milestones: the standard ones (due = the phase target unless overridden)
// and custom ones, per building or project-wide.
export function MilestonesPanel({ view, orgId, projectId, canEdit, canEditProject, run }) {
  const [form, setForm] = useState({ name: '', buildingId: '', dueDate: '' })
  // Filter: everything dated (and custom), or one building's full list (where
  // undated standard milestones get a due date).
  const [filter, setFilter] = useState('')
  const sorted = useMemo(
    () =>
      view.milestones
        .filter((m) => (filter === '' ? m.custom || m.dueDate : filter === 'project' ? !m.buildingId : m.buildingId === filter))
        .sort((a, b) => ((a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : (a.dueDate ?? '9999') > (b.dueDate ?? '9999') ? 1 : a.name.localeCompare(b.name))),
    [view.milestones, filter]
  )
  const editable = (m) => canEdit && (m.buildingId ? true : canEditProject)
  async function add(e) {
    e.preventDefault()
    await run(() => scheduleApi.addMilestone(orgId, projectId, { name: form.name, buildingId: form.buildingId || null, dueDate: form.dueDate || null }), `Added milestone "${form.name}"`)
    setForm({ name: '', buildingId: form.buildingId, dueDate: '' })
  }
  return (
    <Panel
      title="Milestones"
      testId="milestones-panel"
      actions={
        <select aria-label="Show milestones for" value={filter} onChange={(e) => setFilter(e.target.value)} className={inputClass}>
          <option value="">All dated</option>
          <option value="project">Project-wide</option>
          {view.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} (all)
            </option>
          ))}
        </select>
      }
    >
      {canEdit && (
        <form onSubmit={add} className="mb-3 flex flex-wrap items-end gap-2">
          <input required maxLength={120} aria-label="Milestone name" placeholder="Milestone name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={`${inputClass} w-48 flex-1`} />
          <select aria-label="Milestone building" value={form.buildingId} onChange={(e) => setForm((f) => ({ ...f, buildingId: e.target.value }))} className={inputClass}>
            {canEditProject && <option value="">Project-wide</option>}
            {!canEditProject && !form.buildingId && <option value="">Choose a building</option>}
            {view.buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
          <input type="date" aria-label="Milestone due date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className={inputClass} />
          <button type="submit" className={primary} disabled={!form.name.trim() || (!canEditProject && !form.buildingId)}>
            Add
          </button>
        </form>
      )}
      <ul className="divide-y divide-border/60 text-xs">
        {sorted.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-milestone={m.name}>
            <span className="min-w-0">
              <span className={`font-medium ${m.done ? 'text-text-secondary line-through' : 'text-text'}`}>{m.name}</span>
              <span className="text-text-secondary"> · {m.buildingId ? codeOf(view, m.buildingId) : 'Project'}</span>
              {m.custom ? null : <span className="ml-1 rounded bg-surface-muted px-1 text-[10px] text-text-secondary">standard</span>}
            </span>
            <span className="flex items-center gap-1">
              {m.done && <span className="mr-1 inline-flex items-center gap-1 text-status-green"><Check size={13} aria-hidden="true" />Done{m.doneOn ? ` ${m.doneOn}` : ''}</span>}
              {editable(m) && !m.custom && !m.done ? (
                <input
                  type="date"
                  aria-label={`${m.name} ${codeOf(view, m.buildingId)} due`}
                  value={m.dueDate ?? ''}
                  onChange={(e) => run(() => scheduleApi.setStandardDue(orgId, projectId, { buildingId: m.buildingId, standardKey: m.standardKey, dueDate: e.target.value || null }), `${m.name}: due ${e.target.value || 'from the phase target'}`)}
                  className={inputClass}
                />
              ) : (
                !m.done && <span className="text-text-secondary">{m.dueDate ? `due ${m.dueDate}` : 'no date'}</span>
              )}
              {editable(m) && m.custom && (
                <>
                  <button type="button" className={iconBtn} title={m.done ? 'Reopen' : 'Mark done'} aria-label={`${m.done ? 'Reopen' : 'Mark done'} ${m.name}`} onClick={() => run(() => scheduleApi.updateMilestone(orgId, projectId, m.id, { completedOn: m.done ? null : view.today }), `${m.name}: ${m.done ? 'reopened' : 'done'}`)}>
                    {m.done ? <Undo2 size={14} /> : <Check size={14} />}
                  </button>
                  <button type="button" className={iconBtn} title="Delete" aria-label={`Delete ${m.name}`} onClick={() => window.confirm(`Delete the milestone "${m.name}"?`) && run(() => scheduleApi.removeMilestone(orgId, projectId, m.id), `Deleted "${m.name}"`)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
        {sorted.length === 0 && <li className="py-1.5 text-text-secondary">No milestones with a date. Choose a building to set its standard ones.</li>}
      </ul>
      <p className="mt-2 text-[11px] text-text-secondary">Standard (due with the phase target unless set): {STANDARD_MILESTONES.map((m) => m.name).join(', ')}.</p>
    </Panel>
  )
}

// Cross-building dependencies: "B can't start X until A finishes Y".
export function DependenciesPanel({ view, orgId, projectId, canEdit, run }) {
  const first = view.buildings[0]?.id ?? ''
  const [form, setForm] = useState({ fromB: first, fromP: view.phases[0] ?? '', toB: view.buildings[1]?.id ?? first, toP: view.phases[0] ?? '' })
  async function add(e) {
    e.preventDefault()
    await run(() => scheduleApi.addDependency(orgId, projectId, { from: { buildingId: form.fromB, phaseKey: form.fromP }, to: { buildingId: form.toB, phaseKey: form.toP } }), 'Dependency added')
  }
  const sel = (key, label, options) => (
    <select aria-label={label} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={inputClass}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
  const buildingOptions = view.buildings.map((b) => [b.id, b.code])
  const phaseOptions = view.phases.map((p) => [p, PHASE_LABELS[p]])
  return (
    <Panel title="Dependencies between buildings" testId="dependencies-panel">
      {canEdit && view.buildings.length > 1 && (
        <form onSubmit={add} className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {sel('toB', 'Dependent building', buildingOptions)}
          {sel('toP', 'Dependent phase', phaseOptions)}
          <span className="text-text-secondary">waits for</span>
          {sel('fromB', 'Prerequisite building', buildingOptions)}
          {sel('fromP', 'Prerequisite phase', phaseOptions)}
          <button type="submit" className={primary} disabled={form.fromB === form.toB}>
            Add
          </button>
        </form>
      )}
      <ul className="divide-y divide-border/60 text-xs">
        {view.dependencies.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
            <span className="text-text">
              <strong>{codeOf(view, d.to.buildingId)}</strong> {PHASE_LABELS[d.to.phaseKey]} <span className="text-text-secondary">waits for</span> <strong>{codeOf(view, d.from.buildingId)}</strong> {PHASE_LABELS[d.from.phaseKey]}
            </span>
            {canEdit && (
              <button type="button" className={iconBtn} title="Remove" aria-label={`Remove dependency ${codeOf(view, d.to.buildingId)} ${PHASE_LABELS[d.to.phaseKey]}`} onClick={() => run(() => scheduleApi.removeDependency(orgId, projectId, d.id), 'Dependency removed')}>
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
        {view.dependencies.length === 0 && <li className="py-1.5 text-text-secondary">No dependencies between buildings.</li>}
      </ul>
    </Panel>
  )
}

// SLAs with their status and burn-down (v2.2 §21.8).
export function SlaPanel({ view, orgId, projectId, canEdit, canEditProject, run }) {
  const [form, setForm] = useState({ name: '', buildingId: '', phaseKey: '', startDate: view.today, dueDate: '' })
  const [openId, setOpenId] = useState(null)
  const [burn, setBurn] = useState(null)
  useEffect(() => {
    if (!openId) return
    setBurn(null)
    scheduleApi
      .burndown(orgId, projectId, openId)
      .then(setBurn)
      .catch(() => setBurn({ error: true }))
  }, [orgId, projectId, openId, view])
  async function add(e) {
    e.preventDefault()
    await run(() => scheduleApi.createSla(orgId, projectId, { name: form.name, buildingId: form.buildingId || null, phaseKey: form.phaseKey || null, startDate: form.startDate || undefined, dueDate: form.dueDate }), `Added SLA "${form.name}"`)
    setForm((f) => ({ ...f, name: '', dueDate: '' }))
  }
  const editable = (s) => canEdit && (s.buildingId ? true : canEditProject)
  return (
    <Panel title="SLAs" testId="sla-panel">
      {canEdit && (
        <form onSubmit={add} className="mb-3 flex flex-wrap items-end gap-2 text-xs">
          <input required maxLength={120} aria-label="SLA name" placeholder="SLA name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={`${inputClass} w-44 flex-1`} />
          <select aria-label="SLA building" value={form.buildingId} onChange={(e) => setForm((f) => ({ ...f, buildingId: e.target.value }))} className={inputClass}>
            {canEditProject ? <option value="">All buildings</option> : !form.buildingId && <option value="">Choose a building</option>}
            {view.buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
          <select aria-label="SLA phase" value={form.phaseKey} onChange={(e) => setForm((f) => ({ ...f, phaseKey: e.target.value }))} className={inputClass}>
            <option value="">All phases</option>
            {view.phases.map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p]}
              </option>
            ))}
          </select>
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary">Start</span>
            <input type="date" aria-label="SLA start" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary">Due</span>
            <input type="date" required aria-label="SLA due date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className={inputClass} />
          </label>
          <button type="submit" className={primary} disabled={!form.name.trim() || !form.dueDate || (!canEditProject && !form.buildingId) || (form.startDate && form.dueDate < form.startDate)}>
            Add SLA
          </button>
        </form>
      )}
      <ul className="space-y-2 text-xs">
        {view.slas.map((s) => (
          <li key={s.id} className="rounded-lg border border-border/70 p-2" data-sla={s.name}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium text-text">{s.name}</span>
                <span className="text-text-secondary">
                  {' '}
                  · {s.buildingId ? codeOf(view, s.buildingId) : 'All buildings'} · {s.phaseKey ? PHASE_LABELS[s.phaseKey] : 'All phases'} · {s.startDate} → {s.dueDate}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <SlaBadge status={s.status} />
                <span className="text-text-secondary">
                  {s.done}/{s.total} done{s.projectedOn ? ` · projected ${s.projectedOn}` : ''}
                </span>
                <button type="button" className={secondary} onClick={() => setOpenId(openId === s.id ? null : s.id)} aria-expanded={openId === s.id}>
                  {openId === s.id ? 'Hide burn-down' : 'Burn-down'}
                </button>
                {editable(s) && (
                  <button type="button" className={iconBtn} title="Delete" aria-label={`Delete SLA ${s.name}`} onClick={() => window.confirm(`Delete the SLA "${s.name}"?`) && run(() => scheduleApi.removeSla(orgId, projectId, s.id), `Deleted SLA "${s.name}"`)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            </div>
            {s.scopeLimited && <p className="mt-1 text-[11px] text-text-secondary">Counted over the buildings you can see.</p>}
            {openId === s.id && (
              <div className="mt-2">
                {!burn && <p className="text-text-secondary">Loading…</p>}
                {burn?.error && <p className="text-status-red">The burn-down could not be loaded.</p>}
                {burn?.series && <BurndownChart series={burn.series} dueDate={s.dueDate} />}
              </div>
            )}
          </li>
        ))}
        {view.slas.length === 0 && <li className="text-text-secondary">No SLAs.</li>}
      </ul>
    </Panel>
  )
}

// Schedule settings (unscoped PM or Org Admin): parallel phases and the
// at-risk thresholds.
export function SettingsPanel({ view, orgId, projectId, run }) {
  const [form, setForm] = useState(() => ({ ...view.settings }))
  useEffect(() => setForm({ ...view.settings }), [view.settings])
  // Who an SLA breach escalates to besides the PMs and Org Admins (addendum v2.3 Q12).
  const [people, setPeople] = useState([])
  useEffect(() => {
    let live = true
    reportSchedulesApi
      .recipients(orgId, projectId)
      .then((r) => live && setPeople(r.recipients))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [orgId, projectId])
  const toggle = (p) => setForm((f) => ({ ...f, parallelPhases: f.parallelPhases.includes(p) ? f.parallelPhases.filter((x) => x !== p) : [...f.parallelPhases, p] }))
  const save = () => run(() => scheduleApi.updateSettings(orgId, projectId, { riskElapsedPct: Number(form.riskElapsedPct), riskProgressPct: Number(form.riskProgressPct), parallelPhases: form.parallelPhases, escalationContactId: form.escalationContactId || null }), 'Schedule settings saved')
  const valid = [form.riskElapsedPct, form.riskProgressPct].every((v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 100)
  return (
    <Panel title="Schedule settings" testId="schedule-settings">
      <p className="mb-2 text-xs text-text-secondary">A parallel phase starts with the one before it instead of after it.</p>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {view.phases.slice(1).map((p) => (
          <label key={p} className="flex items-center gap-1.5 text-text">
            <input type="checkbox" checked={form.parallelPhases.includes(p)} onChange={() => toggle(p)} />
            {PHASE_LABELS[p]} runs in parallel
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">At risk when time elapsed ≥ (%)</span>
          <input type="number" min={1} max={100} aria-label="Elapsed threshold" value={form.riskElapsedPct} onChange={(e) => setForm((f) => ({ ...f, riskElapsedPct: e.target.value }))} className={`${inputClass} w-24`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">and progress &lt; (%)</span>
          <input type="number" min={1} max={100} aria-label="Progress threshold" value={form.riskProgressPct} onChange={(e) => setForm((f) => ({ ...f, riskProgressPct: e.target.value }))} className={`${inputClass} w-24`} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-text-secondary">SLA breach also escalates to</span>
          <select aria-label="Escalation contact" value={form.escalationContactId ?? ''} onChange={(e) => setForm((f) => ({ ...f, escalationContactId: e.target.value || null }))} className={`${inputClass} max-w-full`}>
            <option value="">The Org Admins only</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name} ({p.roleLabels.join(', ')})
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={primary} disabled={!valid} onClick={save}>
          Save settings
        </button>
      </div>
    </Panel>
  )
}
