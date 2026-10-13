import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, ScrollText, X } from 'lucide-react'
import { ACTIONS } from '@rackium/shared/policy.js'
import { PHASE_LABELS } from '@rackium/shared/notifications.js'
import { formatDateTime } from '@rackium/shared/time.js'
import { auditApi, auditFilters, changeText, downloadAuditCsv, tasksApi } from '../api/workApi.js'
import { projectsApi } from '../api/projectsApi.js'
import { organisationApi } from '../api/organisationApi.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { canIn } from '../lib/realRoles.js'

const inputClass = 'h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none'
const ACTION_TYPES = [
  ['survey', 'Survey'],
  ['hld', 'HLD'],
  ['lld', 'LLD'],
  ['device', 'Devices (rename)'],
  ['solution_package', 'Solution Package'],
  ['change_request', 'Change requests'],
  ['procurement', 'Procurement'],
  ['bom', 'BOM'],
  ['task', 'Tasks'],
  ['blocker', 'Blockers'],
  ['cmo', 'CMO'],
  ['catalogue', 'Catalogue'],
  ['project', 'Projects'],
  ['organisation', 'Organisation'],
  ['view_as', 'View As'],
]
const MODULES = [...Object.entries(PHASE_LABELS), ['tasks', 'Tasks']]

// The audit log (client audit item 16; M5b). The Org Admin reads the whole
// organisation; a PM or Architect picks one of their projects. Filters, pages,
// a detail view with field-level before → after, and a CSV export of what the
// filters select.
export default function AuditLog() {
  const { orgId } = useParams()
  const { memberships } = useAuth()
  const isOrgAdmin = canIn(memberships, orgId, null, ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)
  const [projects, setProjects] = useState([])
  const [form, setForm] = useState({ projectId: '', from: '', to: '', userId: '', action: '', module: '', objectType: '', buildingId: '' })
  const [applied, setApplied] = useState(null)
  const [page, setPage] = useState(null)
  const [people, setPeople] = useState([])
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Projects this user may read the audit of (Org Admin: all).
  const readable = useMemo(() => projects.filter((p) => isOrgAdmin || canIn(memberships, orgId, p.id, ACTIONS.VIEW_AUDIT_LOG)), [projects, isOrgAdmin, memberships, orgId])
  useEffect(() => {
    projectsApi
      .list(orgId)
      .then((r) => setProjects(r.projects))
      .catch((err) => setError(err.message))
  }, [orgId])
  // A PM or Architect starts on their first readable project.
  useEffect(() => {
    if (applied || !projects.length) return
    const start = isOrgAdmin ? { ...form } : { ...form, projectId: readable[0]?.id ?? '' }
    setForm(start)
    setApplied(start)
  }, [projects, readable, isOrgAdmin, applied, form])

  // The user filter's choices: the organisation's members (Org Admin) or the project's.
  useEffect(() => {
    let active = true
    const load = form.projectId ? tasksApi.assignees(orgId, form.projectId).then((r) => r.assignees.map((a) => ({ id: a.userId, name: a.name }))) : isOrgAdmin ? organisationApi.members(orgId).then((r) => [...new Map(r.members.filter((m) => m.user).map((m) => [m.user.id, { id: m.user.id, name: m.user.name || m.user.email }])).values()]) : Promise.resolve([])
    load.then((list) => active && setPeople(list)).catch(() => active && setPeople([]))
    return () => {
      active = false
    }
  }, [orgId, form.projectId, isOrgAdmin])

  const fetchPage = useCallback(
    async (filters, before = null) => {
      setBusy(true)
      try {
        const res = await auditApi.list(orgId, { ...auditFilters(filters), ...(before ? { before } : {}), limit: 50 })
        setPage((p) => (before && p ? { ...res, entries: [...p.entries, ...res.entries] } : res))
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy(false)
      }
    },
    [orgId]
  )
  useEffect(() => {
    if (applied && (isOrgAdmin || applied.projectId)) fetchPage(applied)
  }, [applied, isOrgAdmin, fetchPage])

  const buildings = projects.find((p) => p.id === form.projectId)?.buildings ?? []
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  async function openDetail(entry) {
    try {
      setDetail((await auditApi.get(orgId, entry.id, applied.projectId || null)).entry)
    } catch (err) {
      setError(err.message)
    }
  }
  async function exportCsv() {
    try {
      await downloadAuditCsv(orgId, auditFilters(applied))
    } catch (err) {
      setError(err.message)
    }
  }

  if (projects.length && !isOrgAdmin && !readable.length) return <div className="mx-auto max-w-3xl p-6 text-sm text-text-secondary">The audit log is open to the Org Admin, PMs and Architects.</div>

  return (
    <div className="mx-auto max-w-[1300px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
            <ScrollText size={22} strokeWidth={2} className="text-brand" />
            Audit log
          </h1>
          <p className="text-sm text-text-secondary">Every recorded action, newest first. {isOrgAdmin ? 'View As and Rackium Team access are included.' : 'Limited to the buildings your membership covers.'}</p>
        </div>
        <button type="button" onClick={exportCsv} disabled={!applied || (!isOrgAdmin && !applied.projectId)} className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text hover:border-brand disabled:text-text-secondary">
          <Download size={14} strokeWidth={2} />
          Export CSV
        </button>
      </div>

      <form
        className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-surface p-3 text-xs sm:grid-cols-2 lg:grid-cols-4"
        data-testid="audit-filters"
        onSubmit={(e) => {
          e.preventDefault()
          setDetail(null)
          setApplied({ ...form })
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Project</span>
          <select aria-label="Audit project" value={form.projectId} onChange={(e) => set({ projectId: e.target.value, buildingId: '', userId: '' })} className={inputClass}>
            {isOrgAdmin && <option value="">Whole organisation</option>}
            {readable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">From</span>
          <input aria-label="From date" type="date" value={form.from} onChange={(e) => set({ from: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">To</span>
          <input aria-label="To date" type="date" value={form.to} onChange={(e) => set({ to: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">User</span>
          <select aria-label="Audit user" value={form.userId} onChange={(e) => set({ userId: e.target.value })} className={inputClass}>
            <option value="">Anyone</option>
            {people.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Action type</span>
          <select aria-label="Action type" value={form.action} onChange={(e) => set({ action: e.target.value })} className={inputClass}>
            <option value="">Any</option>
            {ACTION_TYPES.filter(([k]) => isOrgAdmin || k !== 'view_as').map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Module</span>
          <select aria-label="Module" value={form.module} onChange={(e) => set({ module: e.target.value })} className={inputClass}>
            <option value="">Any</option>
            {MODULES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Object type</span>
          <input aria-label="Object type" placeholder="e.g. Task, Connection" value={form.objectType} onChange={(e) => set({ objectType: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Building</span>
          <select aria-label="Audit building" value={form.buildingId} disabled={!form.projectId} onChange={(e) => set({ buildingId: e.target.value })} className={inputClass}>
            <option value="">All</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="h-9 rounded-lg bg-brand px-4 font-medium text-white">
            Apply filters
          </button>
          <button
            type="button"
            onClick={() => {
              const reset = { projectId: form.projectId, from: '', to: '', userId: '', action: '', module: '', objectType: '', buildingId: '' }
              setForm(reset)
              setApplied(reset)
            }}
            className="h-9 rounded-lg border border-border px-3 font-medium text-text"
          >
            Clear
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="text-xs text-status-red">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          {!page && <p className="text-sm text-text-secondary">{busy ? 'Loading…' : 'Choose filters to see entries.'}</p>}
          {page && page.entries.length === 0 && <p className="rounded-xl border border-border bg-surface px-3 py-6 text-center text-xs text-text-secondary">No entries match.</p>}
          {page && page.entries.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full min-w-[720px] text-left text-xs" data-testid="audit-table">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-text-secondary">
                    {['When', 'User', 'Action', 'Object', 'Building', 'Changes'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.entries.map((e) => (
                    <tr key={e.id} onClick={() => openDetail(e)} className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-muted ${detail?.id === e.id ? 'bg-brand/5' : ''}`} data-testid="audit-row">
                      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{formatDateTime(e.occurredAt)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-text">
                        {e.actor.name}
                        {e.actor.role ? <span className="text-text-secondary"> · {e.actor.role}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <button type="button" className="font-medium text-brand hover:underline" onClick={(ev) => (ev.stopPropagation(), openDetail(e))}>
                          {e.action}
                        </button>
                      </td>
                      <td className="max-w-[18rem] truncate px-3 py-1.5 text-text-secondary" title={e.comment ?? ''}>
                        {e.objectType}
                        {e.comment ? ` — ${e.comment}` : ''}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{e.buildingCode ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{e.changeCount || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {page?.nextBefore && (
            <button type="button" disabled={busy} onClick={() => fetchPage(applied, page.nextBefore)} className="mt-2 h-9 rounded-lg border border-border bg-surface px-4 text-xs font-medium text-brand hover:border-brand">
              Load older entries
            </button>
          )}
        </div>
        {detail && (
          <aside className="w-full shrink-0 space-y-2 rounded-xl border border-border bg-surface p-3 text-xs xl:w-96" data-testid="audit-detail">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-text">{detail.action}</div>
                <div className="text-text-secondary">{formatDateTime(detail.occurredAt)}</div>
              </div>
              <button type="button" aria-label="Close detail" onClick={() => setDetail(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 gap-y-1">
              <dt className="text-text-secondary">User</dt>
              <dd className="text-text">
                {detail.actor.name}
                {detail.actor.role ? ` (${detail.actor.role})` : ''}
              </dd>
              <dt className="text-text-secondary">Project</dt>
              <dd className="text-text">{detail.projectName ?? '—'}</dd>
              <dt className="text-text-secondary">Building</dt>
              <dd className="text-text">{detail.buildingCode ?? '—'}</dd>
              <dt className="text-text-secondary">Module</dt>
              <dd className="text-text">{detail.module ?? '—'}</dd>
              <dt className="text-text-secondary">Object</dt>
              <dd className="break-all text-text">
                {detail.objectType} {detail.objectId}
              </dd>
              <dt className="text-text-secondary">Change type</dt>
              <dd className="text-text">
                {detail.changeType} · {detail.source}
              </dd>
              {detail.comment && (
                <>
                  <dt className="text-text-secondary">Comment</dt>
                  <dd className="text-text">{detail.comment}</dd>
                </>
              )}
            </dl>
            <div className="font-semibold text-text">Field changes ({detail.changes.length})</div>
            {detail.changes.length === 0 ? (
              <p className="text-text-secondary">No field-level changes recorded.</p>
            ) : (
              <ul className="space-y-1" data-testid="audit-changes">
                {detail.changes.map((c, i) => (
                  <li key={i} className="break-words rounded bg-surface-muted px-2 py-1 text-text">
                    {changeText(c)}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
