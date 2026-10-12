import { useState } from 'react'
import { History, GitBranch, Save, RotateCcw, Lock } from 'lucide-react'
import { formatDateTime } from '@rackium/shared/time.js'
import DesignDiff from './DesignDiff.jsx'

const inputClass = 'h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none'
const DIFF_COLUMNS = [
  { kind: 'added', title: 'Added', key: 'added' },
  { kind: 'removed', title: 'Removed', key: 'removed' },
  { kind: 'changed', title: 'Changed', key: 'changed' },
]

// Design versions and branches (brief §6.10): save with a label, history,
// a visual diff between any two (or the current design), restore; branches
// are promoted (replacing the main LLD) or discarded — never merged.
// Approved versions are frozen and shown read-only.
export default function LldVersionsPanel({ view, branchId, editable, onSave, onDiff, onRestore, onCreateBranch, onOpenBranch, onPromote, onDiscard }) {
  const [label, setLabel] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('current')
  const [diff, setDiff] = useState(null)
  const [branchName, setBranchName] = useState('')
  const [branchFrom, setBranchFrom] = useState('')
  const current = branchId ? `current:${branchId}` : 'current'
  const refs = [
    { value: 'current', label: 'Current LLD' },
    ...view.branches.filter((b) => b.status === 'open').map((b) => ({ value: `current:${b.id}`, label: `Branch ${b.name} (current)` })),
    ...view.versions.map((v) => ({ value: v.id, label: `v${v.number} ${v.label ?? ''}`.trim() })),
  ]

  async function compare() {
    const result = await onDiff(from || view.versions[0]?.id, to)
    if (result) setDiff(result)
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4" data-testid="lld-versions">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <History size={16} strokeWidth={2} className="text-brand" />
        Versions {view.branch ? <span className="text-xs font-normal text-text-secondary">· on branch {view.branch.name}</span> : null}
      </div>

      {editable && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await onSave(label.trim())) setLabel('')
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
            <span className="text-text-secondary">Version label</span>
            <input aria-label="Version label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. Panels placed" className={inputClass} />
          </label>
          <button type="submit" disabled={!label.trim()} className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 disabled:bg-status-grey">
            <Save size={13} strokeWidth={2} />
            Save version
          </button>
        </form>
      )}

      <ul className="max-h-64 space-y-1 overflow-y-auto text-xs" aria-label="Version history">
        {view.versions.length === 0 && <li className="text-text-secondary">No versions saved yet.</li>}
        {view.versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-2 py-1.5">
            <span className="min-w-0">
              <span className="font-medium text-text">v{v.number}</span> {v.label}
              {v.frozen && (
                <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-status-green/40 px-1 text-status-green">
                  <Lock size={10} strokeWidth={2} />
                  Approved · frozen
                </span>
              )}
              {v.branchId && <span className="ml-1 text-text-secondary">(branch)</span>}
              <span className="block text-text-secondary">
                {v.createdBy} · {formatDateTime(v.createdAt)} · {v.counts.devices} devices, {v.counts.connections} connections
              </span>
            </span>
            {editable && (
              <button type="button" onClick={() => onRestore(v)} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-text hover:border-brand">
                <RotateCcw size={12} strokeWidth={2} />
                Restore
              </button>
            )}
          </li>
        ))}
      </ul>

      {(view.versions.length > 0 || view.branches.some((b) => b.status === 'open')) && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="text-xs font-semibold text-text">Compare</div>
          <div className="flex flex-wrap items-end gap-2">
            <select aria-label="Compare from" value={from || view.versions[0]?.id || 'current'} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} max-w-[12rem]`}>
              {refs.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-text-secondary">→</span>
            <select aria-label="Compare to" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} max-w-[12rem]`}>
              {refs.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={compare} className="h-9 rounded-lg border border-brand px-3 text-xs font-medium text-brand hover:bg-brand/5">
              Show diff
            </button>
          </div>
          {diff && (
            <div className="space-y-2">
              <div className="text-xs text-text-secondary">
                {diff.from} → {diff.to} · {diff.total} change{diff.total === 1 ? '' : 's'}
              </div>
              <DesignDiff columns={DIFF_COLUMNS} sections={[{ title: 'Devices', data: diff.devices }, { title: 'Connections', data: diff.connections }]} empty="The two are identical." />
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
          <GitBranch size={13} strokeWidth={2} className="text-brand" />
          Branches
        </div>
        <ul className="space-y-1 text-xs">
          {view.branches.length === 0 && <li className="text-text-secondary">No branches.</li>}
          {view.branches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium text-text">{b.name}</span> <span className="text-text-secondary">· {b.status}</span>
              </span>
              {b.status === 'open' && (
                <span className="flex flex-wrap gap-1">
                  {branchId === b.id ? (
                    <button type="button" onClick={() => onOpenBranch(null)} className="h-8 rounded-lg border border-border px-2 font-medium text-text hover:border-brand">
                      Back to main
                    </button>
                  ) : (
                    <button type="button" onClick={() => onOpenBranch(b.id)} className="h-8 rounded-lg border border-border px-2 font-medium text-text hover:border-brand">
                      Open
                    </button>
                  )}
                  {editable && (
                    <>
                      <button type="button" onClick={() => onPromote(b)} className="h-8 rounded-lg border border-brand px-2 font-medium text-brand hover:bg-brand/5">
                        Promote
                      </button>
                      <button type="button" onClick={() => onDiscard(b)} className="h-8 rounded-lg border border-status-red/40 px-2 font-medium text-status-red hover:bg-status-red/5">
                        Discard
                      </button>
                    </>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
        {editable && !branchId && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await onCreateBranch(branchName.trim(), branchFrom || undefined)) setBranchName('')
            }}
          >
            <input aria-label="Branch name" value={branchName} onChange={(e) => setBranchName(e.target.value)} maxLength={80} placeholder="Branch name" className={`${inputClass} min-w-0 flex-1`} />
            <select aria-label="Branch from" value={branchFrom} onChange={(e) => setBranchFrom(e.target.value)} className={`${inputClass} max-w-[10rem]`}>
              <option value="">From the current LLD</option>
              {view.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  From v{v.number}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!branchName.trim()} className="h-9 rounded-lg border border-brand px-3 text-xs font-medium text-brand hover:bg-brand/5 disabled:border-border disabled:text-text-secondary">
              Create branch
            </button>
          </form>
        )}
        <p className="text-[11px] text-text-secondary">Promoting replaces the main LLD with the branch; there is no merge. Current: {current === 'current' ? 'main LLD' : 'branch'}.</p>
      </div>
    </div>
  )
}
