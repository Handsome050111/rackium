import { Link } from 'react-router-dom'
import { Server, AlertTriangle, Database, Move } from 'lucide-react'

export default function SurveyInputsPanel({ buildingId, summary }) {
  if (!summary) return null

  return (
    <div className="w-full shrink-0 space-y-3 sm:w-64">
      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 px-1 text-sm font-semibold text-text">Survey inputs</div>
        <div className="space-y-1.5">
          {summary.racks.map((rack) => (
            <Link
              key={rack.rackId}
              to={`/b/${buildingId}/survey/rack?rack=${rack.rackId}`}
              className="flex items-center gap-2 rounded-lg border border-status-green/30 bg-status-green/5 px-2.5 py-2 text-xs hover:border-status-green/60"
            >
              <Server size={14} strokeWidth={2} className="shrink-0 text-status-green" />
              <span className="min-w-0 flex-1 truncate text-text">
                {rack.roomCode} · {rack.rackCode} · {rack.freeU} free U
              </span>
            </Link>
          ))}

          {summary.roomIssues.map((issue) => (
            <Link
              key={`${issue.roomId}-${issue.panelCode}`}
              to={`/b/${buildingId}/survey`}
              className="flex items-center gap-2 rounded-lg border border-status-amber/30 bg-status-amber/5 px-2.5 py-2 text-xs hover:border-status-amber/60"
            >
              <AlertTriangle size={14} strokeWidth={2} className="shrink-0 text-status-amber" />
              <span className="min-w-0 flex-1 truncate text-text">
                {issue.roomCode} · {issue.message}
              </span>
            </Link>
          ))}

          <Link
            to={`/b/${buildingId}/cmo`}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
              summary.cmo.pending > 0 ? 'border-status-amber/30 bg-status-amber/5 hover:border-status-amber/60' : 'border-border hover:border-brand/40'
            }`}
          >
            <Database size={14} strokeWidth={2} className={`shrink-0 ${summary.cmo.pending > 0 ? 'text-status-amber' : 'text-brand'}`} />
            <span className="min-w-0 flex-1 truncate text-text">
              CMO inventory · {summary.cmo.validated}/{summary.cmo.total}
              {summary.cmo.pending > 0 && <span className="text-status-amber"> · {summary.cmo.pending} pending</span>}
            </span>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-text-secondary">
        <Move size={14} strokeWidth={2} className="shrink-0" />
        Drag surveyed objects onto canvas
      </div>
    </div>
  )
}
