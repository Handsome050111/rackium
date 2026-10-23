import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LayoutDashboard, AlertTriangle } from 'lucide-react'
import { insightsApi } from '../api/insightsApi.js'
import { phaseName, pct, scopeNote } from '../lib/insightsFormat.js'
import { BomValue, PeopleTable } from '../components/insights/InsightBits.jsx'
import { StatTile, BarList } from '../components/insights/Charts.jsx'

const card = 'rounded-xl border border-border bg-surface'
const th = 'px-3 py-2 font-medium'

// Project dashboard (brief v2.2 §21.6; M7a-3): buildings by phase, progress,
// overdue, open validation findings, DGUV compliance, team utilisation, and
// the country / SAL rollup — over the buildings the caller can open.
export default function RealProjectDashboard() {
  const { orgId, projectId } = useParams()
  const [view, setView] = useState(null)
  const [rollup, setRollup] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    Promise.all([insightsApi.project(orgId, projectId), insightsApi.rollup(orgId, projectId)])
      .then(([v, r]) => {
        if (!live) return
        setView(v)
        setRollup(r)
        setError(null)
      })
      .catch((err) => live && setError(err.status === 404 ? 'This project is not one you can see.' : err.message))
    return () => {
      live = false
    }
  }, [orgId, projectId])

  const base = `/orgs/${orgId}/projects/${projectId}`
  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 sm:p-6" data-testid="project-dashboard">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
          <LayoutDashboard size={22} strokeWidth={2} className="text-brand" />
          Project dashboard
        </h1>
        {view && <p className="text-sm text-text-secondary">{scopeNote(view.scope)} Today {view.today} ({view.timeZone}).</p>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-red">
          {error}
        </p>
      )}
      {!view && !error && <p className="text-sm text-text-secondary">Loading…</p>}
      {view && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Buildings" value={view.scope.buildings} testId="tile-buildings" />
            <StatTile label="Average progress" value={pct(view.progress)} testId="tile-progress" />
            <StatTile label="Overdue buildings" value={view.overdue.buildings} note={`${view.overdue.phases.length} phase(s) past target`} testId="tile-overdue" />
            <StatTile label="Critical design findings" value={view.validation.critical} note={`${view.validation.warning} warning(s)`} testId="tile-validation" />
            <StatTile label="DGUV compliant" value={pct(view.dguv.compliantPct)} note={`${view.dguv.counts.total} device(s)`} testId="tile-dguv" />
            <StatTile label="Team utilisation" value={pct(view.team.utilisationPct)} note={`${view.team.active} of ${view.team.members} with open tasks`} testId="tile-team" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className={`${card} p-4`}>
              <h2 className="mb-3 text-sm font-semibold text-text">Buildings by current phase</h2>
              <BarList label="Buildings by current phase" testId="by-phase" rows={view.byPhase.map((x) => ({ key: x.phaseKey, label: phaseName(x.phaseKey), value: x.count }))} />
            </section>
            <section className={`${card} p-4`}>
              <h2 className="mb-3 text-sm font-semibold text-text">Overdue phases</h2>
              {view.overdue.phases.length === 0 ? (
                <p className="text-sm text-text-secondary">Nothing is overdue.</p>
              ) : (
                <ul className="space-y-1 text-sm" data-testid="overdue-list">
                  {view.overdue.phases.map((o) => (
                    <li key={`${o.buildingId}:${o.phaseKey}`} className="flex items-center gap-2">
                      <AlertTriangle size={14} className="shrink-0 text-status-red" aria-hidden="true" />
                      <Link to={`${base}/buildings/${o.buildingId}`} className="font-medium text-brand hover:underline">
                        {o.code}
                      </Link>
                      <span className="text-text">{phaseName(o.phaseKey)}</span>
                      <span className="text-text-secondary">target {o.target}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-text-secondary">
                <Link to={`${base}/schedule`} className="text-brand hover:underline">
                  Schedule
                </Link>{' '}
                · <Link to={`${base}/analytics`} className="text-brand hover:underline">Analytics</Link> · <Link to={`${base}/reports`} className="text-brand hover:underline">Reports</Link>
              </p>
            </section>
          </div>

          {rollup && (
            <section className={card} data-testid="rollup">
              <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-text">By country and SAL</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs text-text-secondary">
                    <tr>
                      <th className={th}>Country / SAL</th>
                      <th className={`${th} text-right`}>Buildings</th>
                      <th className={`${th} text-right`}>Average progress</th>
                      <th className={`${th} text-right`}>Overdue</th>
                      {rollup.pricesVisible && <th className={`${th} text-right`}>BOM value</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rollup.countries.map((c) => [
                      <tr key={c.countryId ?? 'none'} className="border-t border-border bg-surface-muted/60 font-medium">
                        <td className="px-3 py-2 text-text">{c.name ? `${c.name} (${c.code})` : 'No country'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.buildings}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(c.avgProgress)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.overdue}</td>
                        {rollup.pricesVisible && <td className="px-3 py-2 text-right"><BomValue value={c.bomValue} /></td>}
                      </tr>,
                      ...c.sals.map((s) => (
                        <tr key={s.salId ?? `${c.countryId}-none`} className="border-t border-border/60" data-sal={s.code}>
                          <td className="px-3 py-2 pl-7 text-text">
                            {s.code ?? 'No SAL'} <span className="text-xs text-text-secondary">{s.buildingCodes.join(', ')}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.buildings}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{pct(s.avgProgress)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.overdue}</td>
                          {rollup.pricesVisible && <td className="px-3 py-2 text-right"><BomValue value={s.bomValue} /></td>}
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className={card} data-testid="building-rows">
            <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-text">Buildings</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-text-secondary">
                  <tr>
                    <th className={th}>Building</th>
                    <th className={th}>Current phase</th>
                    <th className={`${th} text-right`}>Progress</th>
                    <th className={th}>Overdue</th>
                    <th className={`${th} text-right`}>Critical findings</th>
                    <th className={`${th} text-right`}>DGUV compliant</th>
                  </tr>
                </thead>
                <tbody>
                  {view.buildings.map((b) => (
                    <tr key={b.id} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <Link to={`${base}/buildings/${b.id}`} className="font-medium text-brand hover:underline">
                          {b.code}
                        </Link>{' '}
                        <span className="text-xs text-text-secondary">{b.name}</span>
                      </td>
                      <td className="px-3 py-2 text-text">{phaseName(b.currentPhase)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(b.progress)}</td>
                      <td className="px-3 py-2 text-text">{b.overdue.length ? b.overdue.map((o) => phaseName(o.phaseKey)).join(', ') : <span className="text-text-secondary">None</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.validation ? b.validation.critical : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.dguv.total ? pct(b.dguv.compliantPct) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {view.team.personLevel && (
            <section className={card} data-testid="team-people">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <h2 className="text-sm font-semibold text-text">Team</h2>
                <Link to={`${base}/workload`} className="text-xs font-medium text-brand hover:underline">
                  Workload matrix
                </Link>
              </div>
              <PeopleTable people={view.team.people} />
            </section>
          )}
        </>
      )}
    </div>
  )
}
