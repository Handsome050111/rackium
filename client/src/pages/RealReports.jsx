import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { FileBarChart, Download, Pause, Play, Trash2 } from 'lucide-react'
import { ACTIONS, can } from '@rackium/shared/policy.js'
import { REPORTS, REPORT_FORMATS, WEEKDAY_NAMES } from '@rackium/shared/reports.js'
import { COST_ROLES } from '@rackium/shared/documents/types.js'
import { documentsApi } from '../api/documentsApi.js'
import { reportSchedulesApi } from '../api/insightsApi.js'
import { useProjectRoles } from '../lib/useProjectRoles.js'

const REPORT_KEYS = new Set(REPORTS.map((r) => r.key))
const card = 'rounded-xl border border-border bg-surface'
const input = 'h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text focus:border-brand focus:outline-none'
const button = 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50'
const PRICE_LABEL = { none: 'No prices', sell: 'Client prices', cost: 'Cost prices (internal)' }
const STATUS = { queued: 'Queued', generating: 'Generating…', ready: 'Ready', failed: 'Failed' }

// The price modes a role may ask for (the server checks again).
function priceModes(roles) {
  const out = ['none']
  if (can(roles, ACTIONS.SEE_PRICES_MARGINS)) out.push('sell')
  if (roles.some((r) => COST_ROLES.includes(r))) out.push('cost')
  return out
}
const reportsFor = (roles) => REPORTS.filter((r) => !r.person || can(roles, ACTIONS.VIEW_PERSON_METRICS))

// Reports (brief v2.2 §21.9; M7a-3): the seven standard reports on demand —
// PDF, CSV or Excel, made with your role and scope, for you alone — and,
// for the Org Admin and PMs, scheduled weekly or monthly to members, whose
// email carries a sign-in link to their own copy, never the file.
export default function RealReports() {
  const { orgId, projectId } = useParams()
  const [params] = useSearchParams()
  const highlight = params.get('document')
  const { roles, readOnly } = useProjectRoles(orgId, projectId)
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [form, setForm] = useState({ typeKey: 'weekly-status', format: 'pdf', prices: 'none' })
  const highlighted = useRef(null)
  const available = reportsFor(roles)
  const modes = priceModes(roles)
  const manages = !readOnly && can(roles, ACTIONS.MANAGE_REPORT_SCHEDULES)

  // Bumped to load again (after a request, and while a report is being made).
  const [tick, setTick] = useState(0)
  const load = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => {
    let live = true
    documentsApi
      .list(orgId, projectId)
      .then((res) => {
        if (!live) return
        setDocs((res?.documents ?? []).filter((d) => REPORT_KEYS.has(d.typeKey)))
        setError(null)
      })
      .catch((err) => live && setError(err.status === 404 ? 'This project is not one you can see.' : err.message))
    return () => {
      live = false
    }
  }, [orgId, projectId, tick])
  // While a report is being made, look again every 2 seconds.
  const pending = docs?.some((d) => d.status === 'queued' || d.status === 'generating')
  useEffect(() => {
    if (!pending) return undefined
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [pending, load])
  useEffect(() => {
    if (highlight && docs?.some((d) => d.id === highlight)) highlighted.current?.scrollIntoView({ block: 'center' })
  }, [highlight, docs])

  const submit = async (e) => {
    e.preventDefault()
    try {
      const options = form.typeKey === 'bom-summary' ? { prices: form.prices } : {}
      await documentsApi.request(orgId, projectId, { typeKey: form.typeKey, format: form.format, options })
      setNotice('Your report is being made. It appears below when it is ready.')
      setError(null)
    } catch (err) {
      setNotice(null)
      setError(err.message)
    }
    load()
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 sm:p-6" data-testid="reports-page">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
          <FileBarChart size={22} strokeWidth={2} className="text-brand" />
          Reports
        </h1>
        <p className="text-sm text-text-secondary">Each report is made with your role and scope, and only you can open it.</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-red">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-status-green">
          {notice}
        </p>
      )}

      <section className={`${card} p-4`}>
        <h2 className="mb-3 text-sm font-semibold text-text">New report</h2>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3" data-testid="report-form">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Report
            <select aria-label="Report" className={input} value={form.typeKey} onChange={(e) => setForm({ ...form, typeKey: e.target.value })}>
              {available.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Format
            <select aria-label="Format" className={input} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              {REPORT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          {form.typeKey === 'bom-summary' && modes.length > 1 && (
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Prices
              <select aria-label="Prices" className={input} value={form.prices} onChange={(e) => setForm({ ...form, prices: e.target.value })}>
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {PRICE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className={button} disabled={readOnly}>
            Make report
          </button>
        </form>
        {form.typeKey === 'bom-summary' && form.prices === 'cost' && <p className="mt-2 text-xs text-status-amber">Cost prices: an internal document, marked as such, never for the client.</p>}
      </section>

      <section className={card} data-testid="my-reports">
        <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-text">My reports</h2>
        {highlight && docs && !docs.some((d) => d.id === highlight) && <p className="px-4 pt-3 text-sm text-status-red">This report is not one of yours, or it no longer exists.</p>}
        {!docs && <p className="px-4 py-3 text-sm text-text-secondary">Loading…</p>}
        {docs && docs.length === 0 && <p className="px-4 py-3 text-sm text-text-secondary">No reports yet.</p>}
        {docs && docs.length > 0 && (
          <ul className="divide-y divide-border/60">
            {docs.map((d) => (
              <li key={d.id} ref={d.id === highlight ? highlighted : null} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm ${d.id === highlight ? 'bg-brand/5 ring-2 ring-inset ring-brand' : ''}`} data-report={d.id}>
                <span className="min-w-0">
                  <span className="font-medium text-text">{d.typeName}</span> <span className="text-xs text-text-secondary">{d.format.toUpperCase()} · v{d.version}{d.options?.prices && d.options.prices !== 'none' ? ` · ${PRICE_LABEL[d.options.prices]}` : ''} · {new Date(d.requestedAt).toLocaleString('en-GB')}</span>
                </span>
                {d.status === 'ready' ? (
                  <a href={documentsApi.downloadUrl(orgId, projectId, d.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:bg-surface-muted">
                    <Download size={14} aria-hidden="true" />
                    Download
                  </a>
                ) : (
                  <span className={`text-xs ${d.status === 'failed' ? 'text-status-red' : 'text-text-secondary'}`}>{d.status === 'failed' ? `Failed: ${d.error}` : STATUS[d.status]}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {manages && <Schedules orgId={orgId} projectId={projectId} roles={roles} />}
    </div>
  )
}

const EMPTY = { name: '', typeKey: 'weekly-status', format: 'pdf', prices: 'none', frequency: 'weekly', weekday: 1, dayOfMonth: 1, time: '', recipientIds: [] }

function Schedules({ orgId, projectId, roles }) {
  const [list, setList] = useState(null)
  const [people, setPeople] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    Promise.all([reportSchedulesApi.list(orgId, projectId), reportSchedulesApi.recipients(orgId, projectId)])
      .then(([s, r]) => {
        if (!live) return
        setList(s)
        setPeople(r.recipients)
      })
      .catch((err) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [orgId, projectId, tick])
  const run = async (fn, message) => {
    try {
      await fn()
      setNotice(message)
      setError(null)
    } catch (err) {
      setNotice(null)
      setError(err.message)
    }
    setTick((n) => n + 1)
  }
  const toggle = (userId) => setForm((f) => ({ ...f, recipientIds: f.recipientIds.includes(userId) ? f.recipientIds.filter((x) => x !== userId) : [...f.recipientIds, userId] }))
  const create = (e) => {
    e.preventDefault()
    const body = { typeKey: form.typeKey, format: form.format, frequency: form.frequency, recipientIds: form.recipientIds, ...(form.name.trim() ? { name: form.name.trim() } : {}), ...(form.time ? { time: form.time } : {}), ...(form.typeKey === 'bom-summary' ? { prices: form.prices } : {}), ...(form.frequency === 'weekly' ? { weekday: Number(form.weekday) } : { dayOfMonth: Number(form.dayOfMonth) }) }
    run(async () => {
      await reportSchedulesApi.create(orgId, projectId, body)
      setForm(EMPTY)
    }, 'Schedule saved.')
  }
  const modes = useMemo(() => priceModes(roles), [roles])

  return (
    <section className={card} data-testid="report-schedules">
      <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-text">Scheduled reports</h2>
      <div className="space-y-3 p-4">
        <p className="text-xs text-text-secondary">
          Sent at the organisation’s local time{list?.timeZone ? ` (${list.timeZone})` : ''}. Each recipient gets their own copy, made with their role and scope; the email links to it (sign-in needed) and never carries the file. A recipient who loses access is stopped.
        </p>
        {error && (
          <p role="alert" className="text-sm text-status-red">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-status-green">
            {notice}
          </p>
        )}
        {(list?.schedules ?? []).map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-3 text-sm" data-schedule={s.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium text-text">{s.name || s.typeName}</span> <span className="text-xs text-text-secondary">{s.format.toUpperCase()}{s.prices !== 'none' ? ` · ${PRICE_LABEL[s.prices]}` : ''} · {s.description}{s.paused ? ' · paused' : s.nextOn ? ` · next ${s.nextOn}` : ''}</span>
              </span>
              <span className="flex gap-2">
                <button type="button" onClick={() => run(() => reportSchedulesApi.update(orgId, projectId, s.id, { paused: !s.paused }), s.paused ? 'Schedule resumed.' : 'Schedule paused.')} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-text hover:bg-surface-muted">
                  {s.paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
                  {s.paused ? 'Resume' : 'Pause'}
                </button>
                <button type="button" aria-label={`Delete ${s.name || s.typeName}`} onClick={() => run(() => reportSchedulesApi.remove(orgId, projectId, s.id), 'Schedule deleted.')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary hover:bg-surface-muted">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </span>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {s.recipients.map((r) => (
                <li key={r.userId} className={`rounded-full border px-2 py-0.5 ${r.stopped ? 'border-status-red/40 text-status-red' : 'border-border text-text'}`} data-recipient={r.name}>
                  {r.name}
                  {r.stopped && ` — stopped (${r.stopReason === 'access_removed' ? 'access removed' : 'no longer allowed this report'})`}
                </li>
              ))}
            </ul>
          </div>
        ))}

        <form onSubmit={create} className="space-y-3 rounded-lg border border-dashed border-border p-3" data-testid="schedule-form">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Report
              <select aria-label="Scheduled report" className={input} value={form.typeKey} onChange={(e) => setForm({ ...form, typeKey: e.target.value })}>
                {reportsFor(roles).map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Format
              <select aria-label="Scheduled format" className={input} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                {REPORT_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            {form.typeKey === 'bom-summary' && (
              <label className="flex flex-col gap-1 text-xs text-text-secondary">
                Prices
                <select aria-label="Scheduled prices" className={input} value={form.prices} onChange={(e) => setForm({ ...form, prices: e.target.value })}>
                  {modes.map((m) => (
                    <option key={m} value={m}>
                      {PRICE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Every
              <select aria-label="Frequency" className={input} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                <option value="weekly">Week</option>
                <option value="monthly">Month</option>
              </select>
            </label>
            {form.frequency === 'weekly' ? (
              <label className="flex flex-col gap-1 text-xs text-text-secondary">
                On
                <select aria-label="Weekday" className={input} value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <option key={d} value={d}>
                      {WEEKDAY_NAMES[d]}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs text-text-secondary">
                Day
                <input aria-label="Day of the month" type="number" min={1} max={28} className={`${input} w-20`} value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              At (local; empty = morning time)
              <input aria-label="Time" type="time" className={input} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Name (optional)
              <input aria-label="Schedule name" className={input} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          </div>
          <fieldset>
            <legend className="text-xs text-text-secondary">Recipients (members with access to this project)</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {people.map((r) => (
                <label key={r.userId} className="inline-flex min-h-touch items-center gap-2 text-sm text-text sm:min-h-0">
                  <input type="checkbox" checked={form.recipientIds.includes(r.userId)} onChange={() => toggle(r.userId)} />
                  {r.name} <span className="text-xs text-text-secondary">{r.roleLabels.join(', ')}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className={button} disabled={!form.recipientIds.length}>
            Schedule
          </button>
        </form>
      </div>
    </section>
  )
}
