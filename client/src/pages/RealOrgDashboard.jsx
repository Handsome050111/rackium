import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Gauge, AlertTriangle } from 'lucide-react'
import { insightsApi } from '../api/insightsApi.js'
import { pct } from '../lib/insightsFormat.js'
import { BomValue } from '../components/insights/InsightBits.jsx'
import { StatTile } from '../components/insights/Charts.jsx'

const card = 'rounded-xl border border-border bg-surface'
const th = 'px-3 py-2 font-medium'

// Organisation dashboard (brief v2.2 §21.6; M7a-3): the active projects the
// caller can open (the Org Admin: all), at risk, total BOM value (only over
// projects where the caller may see prices) and cross-project utilisation.
export default function RealOrgDashboard() {
  const { orgId } = useParams()
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    insightsApi
      .organisation(orgId)
      .then((v) => {
        if (!live) return
        setView(v)
        setError(null)
      })
      .catch((err) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [orgId])

  const bom = view?.totals.bomValue
  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 sm:p-6" data-testid="org-dashboard">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
          <Gauge size={22} strokeWidth={2} className="text-brand" />
          Organisation dashboard
        </h1>
        {view && <p className="text-sm text-text-secondary">{view.isOrgAdmin ? 'Every active project of the organisation.' : 'The projects you are a member of.'} Totals count only the buildings you can open.</p>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-red">
          {error}
        </p>
      )}
      {!view && !error && <p className="text-sm text-text-secondary">Loading…</p>}
      {view && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Active projects" value={view.totals.projects} note={view.archived ? `${view.archived} archived` : null} />
            <StatTile label="Buildings" value={view.totals.buildings} />
            <StatTile label="Average progress" value={pct(view.totals.progress)} />
            <StatTile label="Projects at risk" value={view.atRisk.length} note={`${view.totals.overdue} building(s) overdue`} testId="tile-at-risk" />
            <StatTile label="Team utilisation" value={pct(view.utilisation.utilisationPct)} note={`${view.utilisation.active} of ${view.utilisation.members} with open tasks`} />
          </div>
          {bom && (
            <p className="text-sm text-text" data-testid="org-bom">
              Total BOM value: <BomValue value={bom} />
              {bom.hiddenProjects > 0 && <span className="text-text-secondary"> — over the {bom.projects} project(s) where you may see prices</span>}
            </p>
          )}

          <section className={card} data-testid="org-projects">
            <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-text">Projects</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-text-secondary">
                  <tr>
                    <th className={th}>Project</th>
                    <th className={th}>Client</th>
                    <th className={`${th} text-right`}>Buildings</th>
                    <th className={`${th} text-right`}>Progress</th>
                    <th className={`${th} text-right`}>Overdue</th>
                    <th className={th}>Status</th>
                    {bom && <th className={`${th} text-right`}>BOM value</th>}
                  </tr>
                </thead>
                <tbody>
                  {view.projects.map((x) => (
                    <tr key={x.id} className="border-t border-border/60" data-project={x.name}>
                      <td className="px-3 py-2">
                        <Link to={`/orgs/${orgId}/projects/${x.id}/dashboard`} className="font-medium text-brand hover:underline">
                          {x.name}
                        </Link>
                        {x.code && <span className="ml-1 text-xs text-text-secondary">{x.code}</span>}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{x.clientName ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {x.buildings}
                        {x.scopeLimited && <span className="ml-1 text-xs text-text-secondary">(your scope)</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(x.progress)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{x.overdue}</td>
                      <td className="px-3 py-2">
                        {x.atRisk ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-status-red">
                            <AlertTriangle size={13} aria-hidden="true" /> At risk
                          </span>
                        ) : (
                          <span className="text-xs text-status-green">On track</span>
                        )}
                      </td>
                      {bom && <td className="px-3 py-2 text-right">{x.bomValue ? <BomValue value={x.bomValue} /> : <span className="text-xs text-text-secondary">Not shown</span>}</td>}
                    </tr>
                  ))}
                  {view.projects.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-3 text-sm text-text-secondary">
                        No active projects.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {view.utilisation.people.length > 0 && (
            <section className={card} data-testid="org-people">
              <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-text">People across projects</h2>
              <p className="px-4 pt-2 text-xs text-text-secondary">From the projects where you are the Org Admin or a PM.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="text-left text-xs text-text-secondary">
                    <tr>
                      <th className={th}>Person</th>
                      <th className={`${th} text-right`}>Projects</th>
                      <th className={`${th} text-right`}>Open tasks</th>
                      <th className={`${th} text-right`}>Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.utilisation.people.map((x) => (
                      <tr key={x.userId} className="border-t border-border/60">
                        <td className="px-3 py-2 text-text">{x.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{x.projects}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{x.openTasks}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${x.overdueTasks ? 'font-semibold text-status-red' : ''}`}>{x.overdueTasks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
