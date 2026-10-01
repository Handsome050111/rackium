import { Plus, Trash2, CheckCircle2, XCircle, Info } from 'lucide-react'

const inputClass = 'h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none'

// Solution Package Required Inputs Group 1 — the one real rule-based form
// (brief Step 7): valid CIDR, VLAN IDs 1-4094, no duplicate VLANs, no
// subnet overlap. Everything else in the register is a simple key/value
// form (KvForm.jsx) — this is the exception, not the template.
export default function AddressingForm({ entries, validation, editable, onAdd, onUpdate, onRemove }) {
  function findingsFor(entryId, field) {
    return validation.findings.filter((f) => f.entryId === entryId && f.field === field)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-text-secondary">Management subnet, VLANs, underlay/overlay pools and rVLAN mappings</div>
        {editable && (
          <button
            type="button"
            onClick={onAdd}
            className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-brand hover:border-brand"
          >
            <Plus size={13} strokeWidth={2} />
            Add entry
          </button>
        )}
      </div>

      <div className="space-y-2">
        {entries.map((entry) => {
          const vlanFindings = findingsFor(entry.id, 'vlanId')
          const cidrFindings = findingsFor(entry.id, 'cidr')
          return (
            <div key={entry.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1.5fr_1fr_1.3fr_1fr_auto]">
              <label className="space-y-1">
                <span className="text-[10px] text-text-secondary">Label</span>
                <input
                  defaultValue={entry.label}
                  disabled={!editable}
                  onBlur={(e) => onUpdate(entry.id, { label: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. Data VLAN"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-text-secondary">VLAN ID</span>
                <input
                  defaultValue={entry.vlanId}
                  disabled={!editable}
                  onBlur={(e) => onUpdate(entry.id, { vlanId: e.target.value })}
                  className={`${inputClass} ${vlanFindings.length > 0 ? 'border-status-red' : ''}`}
                  placeholder="1-4094"
                />
                {vlanFindings.map((f, i) => (
                  <p key={i} className="flex items-center gap-1 text-[10px] text-status-red">
                    <XCircle size={10} strokeWidth={2} /> {f.message}
                  </p>
                ))}
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-text-secondary">CIDR</span>
                <input
                  defaultValue={entry.cidr}
                  disabled={!editable}
                  onBlur={(e) => onUpdate(entry.id, { cidr: e.target.value })}
                  className={`${inputClass} ${cidrFindings.length > 0 ? 'border-status-red' : ''}`}
                  placeholder="10.10.20.0/23"
                />
                {cidrFindings.map((f, i) => (
                  <p key={i} className="flex items-center gap-1 text-[10px] text-status-red">
                    <XCircle size={10} strokeWidth={2} /> {f.message}
                  </p>
                ))}
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-text-secondary">Gateway</span>
                <input
                  defaultValue={entry.gateway}
                  disabled={!editable}
                  onBlur={(e) => onUpdate(entry.id, { gateway: e.target.value })}
                  className={inputClass}
                  placeholder="10.10.20.1"
                />
              </label>
              {editable && (
                <button type="button" onClick={() => onRemove(entry.id)} className="flex h-8 w-8 items-center justify-center self-end rounded-lg text-status-red hover:bg-status-red/10">
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              )}
            </div>
          )
        })}
        {entries.length === 0 && <p className="text-xs text-text-secondary">No addressing entries yet.</p>}
      </div>

      <div
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
          validation.ok ? 'bg-status-green/10 text-status-green' : 'bg-status-amber/10 text-status-amber'
        }`}
      >
        {validation.ok ? <CheckCircle2 size={14} strokeWidth={2} /> : <Info size={14} strokeWidth={2} />}
        {validation.ok ? 'All entries pass format, uniqueness and overlap checks.' : `${validation.findings.length} issue(s) to resolve.`}
      </div>
    </div>
  )
}
