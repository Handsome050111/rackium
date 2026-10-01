import { Plus, Trash2 } from 'lucide-react'

// Groups 2-12 of the Required Inputs register: simple key/value forms
// (brief Step 7 — only Group 1 gets the rule-based CIDR/VLAN form).
export default function KvForm({ pairs, editable, onAdd, onUpdate, onRemove }) {
  return (
    <div className="space-y-2">
      {pairs.map((pair) => (
        <div key={pair.id} className="flex items-center gap-2">
          <input
            defaultValue={pair.key}
            disabled={!editable}
            onBlur={(e) => onUpdate(pair.id, { key: e.target.value })}
            placeholder="Field"
            className="h-8 w-1/3 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none"
          />
          <input
            defaultValue={pair.value}
            disabled={!editable}
            onBlur={(e) => onUpdate(pair.id, { value: e.target.value })}
            placeholder="Value"
            className="h-8 flex-1 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none"
          />
          {editable && (
            <button type="button" onClick={() => onRemove(pair.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-status-red hover:bg-status-red/10">
              <Trash2 size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      ))}
      {pairs.length === 0 && <p className="text-xs text-text-secondary">No values captured yet.</p>}
      {editable && (
        <button type="button" onClick={onAdd} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-brand hover:border-brand">
          <Plus size={13} strokeWidth={2} />
          Add field
        </button>
      )}
    </div>
  )
}
