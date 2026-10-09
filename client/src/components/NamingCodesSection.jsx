import { useState } from 'react'
import { HLD_ROLES, ROLE_CODE_PATTERN, duplicateRoleCodes } from '@rackium/shared/hldRoles.js'

// Hostname role codes (brief §6.6; M4a) — an organisation naming setting.
// F/B/D/E/A are the brief's; the others are proposals the client still has
// to confirm. A code is 1-4 letters or digits and distinct across roles.
export default function NamingCodesSection({ settings, onSave }) {
  const [codes, setCodes] = useState(settings.namingRoleCodes)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const named = HLD_ROLES.filter((r) => r.named)
  const invalid = named.filter((r) => !ROLE_CODE_PATTERN.test(codes[r.role] ?? ''))
  const clashes = duplicateRoleCodes(codes)
  const changed = named.filter((r) => codes[r.role] !== settings.namingRoleCodes[r.role])

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      await onSave(Object.fromEntries(changed.map((r) => [r.role, codes[r.role]])))
      setMessage({ ok: true, text: 'Saved — new devices use these codes; existing hostnames never change on their own.' })
    } catch (err) {
      setMessage({ ok: false, text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {named.map((r) => (
          <label key={r.role} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
            <span className="text-text">
              {r.label}
              {settings.proposedRoleCodeKeys.includes(r.role) && <span className="ml-1 rounded bg-status-amber/10 px-1 text-[10px] text-status-amber">proposed — client to confirm</span>}
            </span>
            <input
              value={codes[r.role] ?? ''}
              onChange={(e) => setCodes((c) => ({ ...c, [r.role]: e.target.value.toUpperCase() }))}
              aria-label={`${r.label} hostname code`}
              maxLength={4}
              className={`h-8 w-16 rounded-lg border bg-surface px-2 text-center text-xs font-semibold uppercase focus:border-brand focus:outline-none ${ROLE_CODE_PATTERN.test(codes[r.role] ?? '') ? 'border-border' : 'border-status-red'}`}
            />
          </label>
        ))}
      </div>
      <p className="text-[11px] text-text-secondary">WAN/SP connections and remote sites carry no hostname.</p>
      {invalid.length > 0 && <p className="text-xs text-status-red">Use 1 to 4 letters or digits for: {invalid.map((r) => r.label).join(', ')}</p>}
      {clashes.map((c) => (
        <p key={c} className="text-xs text-status-red">
          {c}
        </p>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || changed.length === 0 || invalid.length > 0 || clashes.length > 0}
          className="h-9 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey"
        >
          {saving ? 'Saving…' : 'Save codes'}
        </button>
        {message && <span className={`text-xs ${message.ok ? 'text-status-green' : 'text-status-red'}`}>{message.text}</span>}
      </div>
    </div>
  )
}
