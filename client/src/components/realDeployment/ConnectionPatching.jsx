import { useState } from 'react'
import { CheckCircle2, XCircle, ShieldCheck, Cable } from 'lucide-react'
import { patchingDraft, patchingBody } from '../../api/deploymentApi.js'
import { MEDIA_COLOURS } from './mediaColours.js'

const input = 'h-touch w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-sm text-text focus:border-brand focus:outline-none disabled:bg-surface-muted'
const STATUS_TONE = { approved: 'text-text-secondary', designed: 'text-text-secondary', installed: 'text-status-amber', tested: 'text-status-green', accepted: 'text-status-green', faulty: 'text-status-red' }

// One connection of the selected device: patching per end and per cable
// (cable ID, Installed length, confirmed), the link test and acceptance.
export default function ConnectionPatching({ conn, canInstall, canAccept, onSave, onTest, onAccept, onLogException }) {
  const [draft, setDraft] = useState(() => patchingDraft(conn))
  const locked = conn.status === 'accepted' || !canInstall
  const setSeg = (i, patch) => setDraft((d) => ({ ...d, segments: d.segments.map((s, k) => (k === i ? { ...s, ...patch } : s)) }))
  const open = conn.deviations.filter((x) => !x.handled)
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-3" data-testid={`connection-${conn.id}`}>
      <div className="flex items-start gap-2">
        <Cable size={16} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: MEDIA_COLOURS[conn.media] ?? '#094F9A' }} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="break-words font-semibold text-text">
            {conn.source.name} {conn.source.portId ?? ''} → {conn.dest.name} {conn.dest.portId ?? ''}
          </div>
          <div className="text-xs text-text-secondary">
            {conn.media.toUpperCase()} · {conn.speed}
            {conn.hops.length > 0 && ` · via ${conn.hops.map((h) => `${h.name} ${h.inPort}/${h.outPort}`).join(', ')}`}
          </div>
        </div>
        <span className={`shrink-0 text-xs font-semibold ${STATUS_TONE[conn.status] ?? 'text-text-secondary'}`}>{conn.statusLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-text-secondary">
          Source port
          <input className={input} value={draft.sourcePort} disabled={locked} onChange={(e) => setDraft({ ...draft, sourcePort: e.target.value })} />
        </label>
        <label className="text-xs text-text-secondary">
          Destination port
          <input className={input} value={draft.destPort} disabled={locked} onChange={(e) => setDraft({ ...draft, destPort: e.target.value })} />
        </label>
      </div>

      <div className="space-y-2">
        {conn.segments.map((s, i) => (
          <div key={s.index} className="rounded-lg border border-border p-2">
            <div className="mb-1 text-xs font-medium text-text">
              Cable {s.index + 1} · {s.from.name} → {s.to.name}
              <span className="ml-1 font-normal text-text-secondary">(designed {s.cableId ?? 'no ID'}, {s.effectiveM != null ? `${s.effectiveM} m` : 'length n/a'})</span>
            </div>
            <div className="grid grid-cols-[1fr_6rem] gap-2 sm:grid-cols-[1fr_7rem_auto]">
              <label className="text-xs text-text-secondary">
                Cable ID
                <input className={input} aria-label={`Cable ${s.index + 1} ID`} value={draft.segments[i].cableId} disabled={locked} onChange={(e) => setSeg(i, { cableId: e.target.value })} />
              </label>
              <label className="text-xs text-text-secondary">
                Installed m
                <input className={input} aria-label={`Cable ${s.index + 1} installed length`} type="number" inputMode="decimal" min="0" step="0.1" value={draft.segments[i].installedM} disabled={locked} onChange={(e) => setSeg(i, { installedM: e.target.value })} />
              </label>
              <label className="col-span-2 flex h-touch items-center gap-2 text-sm text-text sm:col-span-1 sm:self-end">
                <input type="checkbox" className="h-5 w-5" checked={draft.segments[i].confirmed} disabled={locked} onChange={(e) => setSeg(i, { confirmed: e.target.checked })} />
                Confirmed
              </label>
            </div>
          </div>
        ))}
      </div>

      {conn.deviations.length > 0 && (
        <ul className="space-y-1 text-xs">
          {conn.deviations.map((x) => (
            <li key={x.field} className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 ${x.handled ? 'bg-surface-muted text-text-secondary' : 'bg-status-amber/10 text-status-amber'}`}>
              <span className="font-semibold">{x.label}</span>
              <span>
                designed {x.designedValue}, installed {x.installedValue}
              </span>
              {x.handled ? <span>· exception logged</span> : canInstall && <button type="button" className="ml-auto h-8 rounded-lg border border-current px-2 font-medium" onClick={() => onLogException(x)}>Log exception</button>}
            </li>
          ))}
        </ul>
      )}

      {conn.test && (
        <div className={`text-xs ${conn.test.result === 'pass' ? 'text-status-green' : 'text-status-red'}`}>
          Link test {conn.test.result === 'pass' ? 'passed' : 'failed'}
          {conn.test.note ? ` — ${conn.test.note}` : ''} {conn.test.by ? `· ${conn.test.by}` : ''}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canInstall && conn.status !== 'accepted' && (
          <>
            <button type="button" className="h-touch rounded-lg border border-border px-3 text-sm font-medium text-text" onClick={() => onSave(patchingBody(draft))}>
              Save
            </button>
            <button type="button" className="h-touch rounded-lg bg-brand px-3 text-sm font-semibold text-white" onClick={() => onSave(patchingBody(draft, { confirm: true }))}>
              Confirm patching
            </button>
          </>
        )}
        {canInstall && ['installed', 'tested', 'faulty'].includes(conn.status) && (
          <>
            <button type="button" className="inline-flex h-touch items-center gap-1 rounded-lg border border-status-green px-3 text-sm font-medium text-status-green" onClick={() => onTest('pass')}>
              <CheckCircle2 size={16} strokeWidth={2} /> Test passed
            </button>
            <button type="button" className="inline-flex h-touch items-center gap-1 rounded-lg border border-status-red px-3 text-sm font-medium text-status-red" onClick={() => onTest('fail')}>
              <XCircle size={16} strokeWidth={2} /> Test failed
            </button>
          </>
        )}
        {canAccept && conn.status === 'tested' && (
          <button type="button" className="inline-flex h-touch items-center gap-1 rounded-lg bg-status-green px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={open.length > 0} onClick={onAccept}>
            <ShieldCheck size={16} strokeWidth={2} /> Accept connection
          </button>
        )}
      </div>
    </div>
  )
}
