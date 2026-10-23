import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LineChart } from 'lucide-react'
import { METRIC_LABELS } from '@rackium/shared/reports.js'
import { insightsApi } from '../api/insightsApi.js'
import { phaseName, pct, scopeNote } from '../lib/insightsFormat.js'
import { TrendLine } from '../components/insights/Charts.jsx'

const GATE = { hld_internal: 'HLD review', lld_internal: 'LLD review', sp_internal: 'Solution Package review', sp_client: 'Client: Solution Package', deployment_acceptance: 'Installation acceptance', handover_client: 'Client: handover', change_request: 'Client: change request' }
const days = (n) => (n == null ? '—' : `${n} d`)

// One metric: its headline, a monthly trend and how many rows were left out
// because their date is unknown (shown, never hidden).
function Metric({ id, headline, sub, trend, unit, title, excluded, children }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid={`metric-${id}`}>
      <h2 className="text-sm font-semibold text-text">{METRIC_LABELS[id]}</h2>
      <p className="mt-1 text-2xl font-semibold text-text">{headline}</p>
      {sub && <p className="text-xs text-text-secondary">{sub}</p>}
      <div className="mt-3">
        <TrendLine points={trend} unit={unit} title={title} testId={`trend-${id}`} />
      </div>
      {excluded > 0 && (
        <p className="mt-2 text-xs text-status-amber" data-testid={`excluded-${id}`}>
          {excluded} row(s) with an unknown date left out
        </p>
      )}
      {children}
    </section>
  )
}

const small = 'mt-3 w-full text-left text-xs'

// Analytics (brief v2.2 §21.9; M7a-3): six metrics with monthly trend lines
// over the caller's buildings. Survey completion by technician only for the
// Org Admin and PMs (the server leaves it out for anyone else).
export default function RealAnalytics() {
  const { orgId, projectId } = useParams()
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    insightsApi
      .analytics(orgId, projectId)
      .then((v) => {
        if (!live) return
        setView(v)
        setError(null)
      })
      .catch((err) => live && setError(err.status === 404 ? 'This project is not one you can see.' : err.message))
    return () => {
      live = false
    }
  }, [orgId, projectId])

  const m = view?.metrics
  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 sm:p-6" data-testid="analytics-page">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
          <LineChart size={22} strokeWidth={2} className="text-brand" />
          Analytics
        </h1>
        {view && <p className="text-sm text-text-secondary">{scopeNote(view.scope)} Trends by month ({view.timeZone}).</p>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-red">
          {error}
        </p>
      )}
      {!view && !error && <p className="text-sm text-text-secondary">Loading…</p>}
      {m && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Metric id="phaseDuration" headline={days(m.phaseDuration.avgDays)} sub={`Average over ${m.phaseDuration.count} completed phase(s)`} trend={m.phaseDuration.trend} unit=" d" title="Average phase duration by month of completion" excluded={m.phaseDuration.excluded}>
            <table className={small}>
              <tbody>
                {m.phaseDuration.phases.filter((x) => x.count).map((x) => (
                  <tr key={x.phaseKey} className="border-t border-border/60">
                    <td className="py-1">{phaseName(x.phaseKey)}</td>
                    <td className="py-1 text-right tabular-nums">{days(x.avgDays)}</td>
                    <td className="py-1 text-right tabular-nums text-text-secondary">{x.count}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Metric>
          <Metric id="blockerFrequency" headline={`${m.blockerFrequency.total}`} sub={`Blockers raised · ${m.blockerFrequency.perMonth ?? 0} per month on average`} trend={m.blockerFrequency.trend} title="Blockers raised per month" excluded={m.blockerFrequency.excluded}>
            <p className="mt-2 text-xs text-text-secondary">{Object.entries(m.blockerFrequency.byPhase).map(([k, v]) => `${phaseName(k)} ${v}`).join(' · ') || 'None raised'}</p>
          </Metric>
          <Metric id="blockerResolution" headline={days(m.blockerResolution.avgDays)} sub={`${m.blockerResolution.count} resolved · ${m.blockerResolution.open} still open`} trend={m.blockerResolution.trend} unit=" d" title="Average days to resolve, by month resolved" excluded={m.blockerResolution.excluded} />
          <Metric id="bomVariance" headline={pct(m.bomVariance.avgVariancePct)} sub={`Latest approved procurement BOM against the first · ${m.bomVariance.changed} of ${m.bomVariance.count} building(s) changed`} trend={m.bomVariance.trend} unit="%" title="BOM variance by month of the latest version" excluded={m.bomVariance.excluded}>
            {m.bomVariance.buildings.length > 0 && <p className="mt-2 text-xs text-text-secondary">{m.bomVariance.buildings.map((b) => `${b.code}: ${b.variancePct}% (${b.versions} version(s))`).join(' · ')}</p>}
          </Metric>
          <Metric id="surveyCompletion" headline={pct(m.surveyCompletion.completionPct)} sub={`${m.surveyCompletion.verified} of ${m.surveyCompletion.expected} survey tab(s) verified`} trend={m.surveyCompletion.trend} title="Survey tabs verified per month" excluded={m.surveyCompletion.excluded}>
            {m.surveyCompletion.byTechnician && (
              <table className={small} data-testid="by-technician">
                <thead className="text-text-secondary">
                  <tr>
                    <th className="py-1 font-medium">Technician</th>
                    <th className="py-1 text-right font-medium">Submitted</th>
                    <th className="py-1 text-right font-medium">Verified</th>
                    <th className="py-1 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {m.surveyCompletion.byTechnician.map((x) => (
                    <tr key={x.userId} className="border-t border-border/60">
                      <td className="py-1">{x.name}</td>
                      <td className="py-1 text-right tabular-nums">{x.submitted}</td>
                      <td className="py-1 text-right tabular-nums">{x.verified}</td>
                      <td className="py-1 text-right tabular-nums">{pct(x.completionPct)}</td>
                    </tr>
                  ))}
                  {m.surveyCompletion.byTechnician.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-1 text-text-secondary">
                        No tab submitted yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </Metric>
          <Metric id="approvalTurnaround" headline={days(m.approvalTurnaround.avgDays)} sub={`${m.approvalTurnaround.count} decided · ${m.approvalTurnaround.pending} pending`} trend={m.approvalTurnaround.trend} unit=" d" title="Average days from submission to decision, by month decided" excluded={m.approvalTurnaround.excluded}>
            <table className={small}>
              <tbody>
                {m.approvalTurnaround.byGate.map((g) => (
                  <tr key={g.gate} className="border-t border-border/60">
                    <td className="py-1">{GATE[g.gate] ?? g.gate}</td>
                    <td className="py-1 text-right tabular-nums">{days(g.avgDays)}</td>
                    <td className="py-1 text-right tabular-nums text-text-secondary">{g.count}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Metric>
        </div>
      )}
    </div>
  )
}
