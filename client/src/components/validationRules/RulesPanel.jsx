import { useState } from 'react'
import { Plus } from 'lucide-react'
import { describeRule } from '@rackium/shared/customRules.js'
import RuleForm from './RuleForm.jsx'

const TONE = { critical: 'text-status-red', warning: 'text-status-amber', info: 'text-brand' }
const SEVERITY = { critical: 'Critical', warning: 'Warning', info: 'Info' }

// One level's custom rules (M7b-5, DATA-MODEL §3.11): the list, with the
// builder for those who may write them. `api`: create, update, setEnabled,
// remove; `onChanged`: reload after a write. A change applies from the next
// validation; nothing already approved is reopened.
export default function RulesPanel({ rules, labels, canEdit, api, targets, onPreview, onChanged, testId, empty = 'No rules yet.' }) {
  const [editing, setEditing] = useState(null) // 'new' or a rule id
  const [confirming, setConfirming] = useState(null)
  const [error, setError] = useState(null)

  async function act(fn) {
    setError(null)
    try {
      await fn()
      await onChanged()
    } catch (err) {
      setError(err.message)
    }
  }
  async function save(rule, body) {
    if (rule) await api.update(rule.id, body)
    else await api.create(body)
    setEditing(null)
    await onChanged()
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      {rules.length === 0 && editing !== 'new' && <p className="text-xs text-text-secondary">{empty}</p>}
      <ul className="space-y-2">
        {rules.map((r) =>
          editing === r.id ? (
            <li key={r.id}>
              <RuleForm rule={r} labels={labels} targets={targets} onPreview={onPreview} onSave={(body) => save(r, body)} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={r.id} data-testid={`rule-${r.id}`} className={`flex flex-col gap-2 rounded-lg border border-border p-3 text-xs sm:flex-row sm:items-start sm:justify-between ${r.enabled ? '' : 'opacity-60'}`}>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="min-w-0 break-words font-medium text-text">{r.name}</span>
                  <span className={`text-xs font-semibold ${TONE[r.severity]}`}>{SEVERITY[r.severity]}</span>
                  {!r.enabled && <span className="text-xs text-text-secondary">Off</span>}
                </div>
                <p className="break-words text-text-secondary">{describeRule(r, labels)}</p>
                {r.message && <p className="break-words text-text-secondary">“{r.message}”</p>}
              </div>
              {canEdit && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <label className="flex h-touch items-center gap-1.5 text-text sm:h-8">
                    <input type="checkbox" checked={r.enabled} aria-label={`${r.name} on`} onChange={(e) => act(() => api.setEnabled(r.id, e.target.checked))} />
                    On
                  </label>
                  <button type="button" onClick={() => setEditing(r.id)} className="h-touch rounded-lg border border-border px-3 font-medium text-text hover:bg-surface-muted sm:h-8">
                    Edit
                  </button>
                  {confirming === r.id ? (
                    <button type="button" onClick={() => act(() => api.remove(r.id))} className="h-touch rounded-lg border border-status-red/40 px-3 font-medium text-status-red hover:bg-status-red/5 sm:h-8">
                      Delete for good
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirming(r.id)} className="h-touch rounded-lg border border-border px-3 font-medium text-text-secondary hover:text-text sm:h-8">
                      Delete
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        )}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-status-red">
          {error}
        </p>
      )}
      {canEdit &&
        (editing === 'new' ? (
          <RuleForm labels={labels} targets={targets} onPreview={onPreview} onSave={(body) => save(null, body)} onCancel={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing('new')} className="inline-flex h-touch items-center gap-1.5 rounded-lg border border-brand px-3 text-sm font-medium text-brand hover:bg-brand/5 sm:h-9">
            <Plus size={15} strokeWidth={2} /> Add a rule
          </button>
        ))}
    </div>
  )
}
