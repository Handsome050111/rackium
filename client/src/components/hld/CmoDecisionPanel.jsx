import { useState } from 'react'
import { decisionText, inFuture } from '@rackium/shared/modeState.js'
import TopologyIcon from '../TopologyIcon.jsx'

const selectClass = 'h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none disabled:bg-surface-muted'

// A selected CMO device (M7b-4a, DATA-MODEL §5.21): what it is, where it is,
// and what the future design does with it — Keep (a role; the naming pattern
// gives the new name, applied when the LLD is approved), Replace (by a device
// of the future design) or Remove. `futureDevices`: the design's FMO devices.
export default function CmoDecisionPanel({ device, labels, roles, futureDevices, editable, busy, onDecide, onClear }) {
  const current = device.cmoDecision
  const [choice, setChoice] = useState(current?.decision ?? 'keep')
  const [role, setRole] = useState(current?.role ?? device.role ?? '')
  const [replacedById, setReplacedById] = useState(current?.replacedById ?? '')
  const named = roles.filter((r) => r.category && !r.group?.startsWith('external'))
  const ready = choice === 'keep' ? Boolean(role) : choice === 'replace' ? Boolean(replacedById) : true
  const body = choice === 'keep' ? { decision: 'keep', role } : choice === 'replace' ? { decision: 'replace', replacedById } : { decision: 'remove' }
  const applied = device.modeState === 'future'

  return (
    <div data-testid="cmo-decision" className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-2 text-sm font-semibold text-text">
        <TopologyIcon role={device.role ?? 'existing'} size={16} className="mt-0.5 shrink-0 text-brand" />
        <span className="min-w-0 break-all">{device.label}</span>
      </div>
      <dl className="space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">Mode state</dt>
          <dd className="font-medium text-text">{inFuture(device) === true ? `${labels.current} → ${labels.future}` : labels.current}</dd>
        </div>
        {device.model && (
          <div className="flex justify-between gap-2">
            <dt className="text-text-secondary">Model</dt>
            <dd className="min-w-0 break-all text-right font-medium text-text">{device.model}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">Serial</dt>
          <dd className="font-medium text-text">{device.serial ?? 'No serial'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">Where</dt>
          <dd className="text-right font-medium text-text">{[device.roomCode, device.rackCode && `rack ${device.rackCode}`].filter(Boolean).join(' · ') || 'Not placed'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">In the {labels.future}</dt>
          <dd data-testid="cmo-decision-text" className="min-w-0 break-all text-right font-medium text-text">
            {decisionText(current, labels)}
          </dd>
        </div>
      </dl>
      {applied && <p className="text-xs text-text-secondary">Applied when the LLD was approved{device.legacyHostname ? `: renamed from ${device.legacyHostname}` : ''}.</p>}
      {!applied && current?.decision === 'keep' && current.hostname && <p className="text-xs text-text-secondary">The new name is applied when the LLD is approved; the old one is kept and shown first.</p>}

      {editable && (
        <div className="space-y-3 border-t border-border pt-3">
          <div role="radiogroup" aria-label="Decision" className="grid grid-cols-3 overflow-hidden rounded-lg border border-border text-xs">
            {[
              ['keep', 'Keep'],
              ['replace', 'Replace'],
              ['remove', 'Remove'],
            ].map(([value, text]) => (
              <button key={value} type="button" role="radio" aria-checked={choice === value} onClick={() => setChoice(value)} className={`h-touch font-medium sm:h-8 ${choice === value ? 'bg-brand text-white' : 'bg-surface text-text-secondary hover:text-text'}`}>
                {text}
              </button>
            ))}
          </div>
          {choice === 'keep' && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-text-secondary">Role in the {labels.future}</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role in the future design" className={selectClass}>
                <option value="">Choose…</option>
                {named.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {choice === 'replace' && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-text-secondary">Replaced by</span>
              <select value={replacedById} onChange={(e) => setReplacedById(e.target.value)} aria-label="Replaced by" className={selectClass}>
                <option value="">Choose…</option>
                {futureDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.roleLabel ?? d.role} · {d.hostname ?? d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {choice === 'remove' && <p className="text-xs text-text-secondary">Stays in the {labels.current} only — no link of the {labels.future} may end on it.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!ready || busy} onClick={() => onDecide(body)} className="h-touch rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9">
              Save decision
            </button>
            {current && (
              <button type="button" disabled={busy} onClick={onClear} className="h-touch rounded-lg border border-border px-3 text-xs font-medium text-text-secondary hover:text-text sm:h-9">
                Clear decision
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
