import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { insightsApi } from '../api/insightsApi.js'
import { phaseName, scopeNote } from '../lib/insightsFormat.js'

// A cell: open tasks, and the overdue ones in red with a word (never colour alone).
function Cell({ cell }) {
  if (!cell?.tasks) return <span className="text-text-secondary">·</span>
  return (
    <span className="tabular-nums">
      {cell.tasks}
      {cell.overdue > 0 && <span className="ml-1 text-xs font-semibold text-status-red">{cell.overdue} overdue</span>}
    </span>
  )
}

// Workload matrix (brief v2.2 §21.5; M7a-3): member × building with task
// and overdue counts. The Org Admin and PMs only (the server answers 403 to
// anyone else); a scoped PM sees the buildings of their scope.
export default function RealWorkload() {
  const { orgId, projectId } = useParams()
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    insightsApi
      .workload(orgId, projectId)
      .then((v) => {
        if (!live) return
        setView(v)
        setError(null)
      })
      .catch((err) => live && setError(err.status === 403 ? 'The workload shows figures per person: it is for the Org Admin and PMs.' : err.status === 404 ? 'This project is not one you can see.' : err.message))
    return () => {
      live = false
    }
  }, [orgId, projectId])

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 sm:p-6" data-testid="workload-page">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
          <Users size={22} strokeWidth={2} className="text-brand" />
          Workload
        </h1>
        {view && <p className="text-sm text-text-secondary">{scopeNote(view.scope)} Open tasks per person and building; {view.totals.tasks} open, {view.totals.overdue} overdue.</p>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-red">
          {error}
        </p>
      )}
      {!view && !error && <p className="text-sm text-text-secondary">Loading…</p>}
      {view && (
        <section className="rounded-xl border border-border bg-surface" data-testid="workload-matrix">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-text-secondary">
                <tr>
                  <th className="sticky left-0 z-10 bg-surface px-3 py-2 font-medium">Person</th>
                  {view.buildings.map((b) => (
                    <th key={b.id} className="px-3 py-2 text-right font-medium">
                      <Link to={`/orgs/${orgId}/projects/${projectId}/buildings/${b.id}`} className="text-brand hover:underline">
                        {b.code}
                      </Link>
                      <span className="block font-normal">{phaseName(b.currentPhase)}</span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Project-wide</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {view.people.map((x) => (
                  <tr key={x.userId} className="border-t border-border/60" data-person={x.name}>
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text">
                      <span className="whitespace-nowrap">{x.name}</span>
                      <span className="block text-xs text-text-secondary">
                        {x.role?.replace('_', ' ')}
                        {x.primaryFor.length > 0 && ` · primary for ${x.primaryFor.join(', ')}`}
                      </span>
                    </td>
                    {view.buildings.map((b) => (
                      <td key={b.id} className="px-3 py-2 text-right" data-cell={`${x.name}|${b.code}`}>
                        <Cell cell={x.cells[b.id]} />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <Cell cell={x.projectWide} />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      <Cell cell={{ tasks: x.openTasks, overdue: x.overdueTasks }} />
                    </td>
                  </tr>
                ))}
                {view.people.length === 0 && (
                  <tr>
                    <td colSpan={view.buildings.length + 3} className="px-3 py-3 text-sm text-text-secondary">
                      No members with work in these buildings.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t border-border text-xs text-text-secondary">
                <tr>
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2 font-medium">All</td>
                  {view.buildings.map((b) => (
                    <td key={b.id} className="px-3 py-2 text-right">
                      <Cell cell={view.totals.byBuilding[b.id]} />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <Cell cell={view.totals.projectWide} />
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    <Cell cell={{ tasks: view.totals.tasks, overdue: view.totals.overdue }} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
