import { Outlet, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react'
import { RealSurveySyncProvider, useRealSurveySync } from '../../lib/RealSurveySync.jsx'
import { formatValue } from '../../lib/realSurveyModel.js'

function SyncReport() {
  const { report, clearReport, isOffline, pending, syncing, syncNow } = useRealSurveySync()
  const waiting = pending.edits + pending.uploads
  return (
    <div className="mx-auto max-w-[1700px] space-y-2 px-4 pt-4 sm:px-6 empty:hidden">
      {isOffline && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-status-amber/40 bg-status-amber/5 px-3 py-2 text-xs text-status-amber">
          <CloudOff size={14} strokeWidth={2} />
          Offline — survey tabs already open keep working; {waiting} change{waiting === 1 ? '' : 's'} waiting to sync. Site structure and rack layout need a connection.
        </div>
      )}
      {!isOffline && waiting > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
          <RefreshCw size={14} strokeWidth={2} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : `${waiting} change${waiting === 1 ? '' : 's'} waiting to sync`}
          {!syncing && (
            <button type="button" onClick={syncNow} className="font-medium text-brand hover:underline">
              Sync now
            </button>
          )}
        </div>
      )}
      {report && (
        <div data-testid="sync-report" className="space-y-1 rounded-xl border border-border bg-surface p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-text">Sync report · {new Date(report.at).toLocaleTimeString()}</span>
            <button type="button" onClick={clearReport} className="text-[11px] font-medium text-text-secondary hover:text-text">
              Dismiss
            </button>
          </div>
          {report.lines.map((line, i) => (
            <div key={i} className="text-text-secondary">
              {line.kind === 'applied' && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 size={12} strokeWidth={2} className="text-status-green" />
                  {line.what} — synced
                </span>
              )}
              {line.kind === 'conflict' && (
                <div>
                  <span className="flex items-center gap-1 text-status-amber">
                    <AlertTriangle size={12} strokeWidth={2} />
                    {line.what} — saved (last save wins); it overwrote a change{line.conflict?.changedBy ? ` by ${line.conflict.changedBy}` : ''}
                    {line.conflict?.changedAt ? ` at ${new Date(line.conflict.changedAt).toLocaleString()}` : ''}
                  </span>
                  {line.conflict?.fields?.map((f) => (
                    <div key={f.field} className="pl-4">
                      {f.field}: {formatValue(f.theirValue)} → {formatValue(f.yourValue)}
                    </div>
                  ))}
                </div>
              )}
              {(line.kind === 'skipped' || line.kind === 'rejected') && (
                <span className="flex items-center gap-1 text-status-red">
                  <AlertTriangle size={12} strokeWidth={2} />
                  {line.what} — not applied: {line.reason}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Wraps the real-mode survey screens of a building in the offline/sync context.
export default function RealSurveyLayout() {
  const { orgId, projectId } = useParams()
  return (
    <RealSurveySyncProvider key={`${orgId}/${projectId}`} orgId={orgId} projectId={projectId}>
      <SyncReport />
      <Outlet />
    </RealSurveySyncProvider>
  )
}
