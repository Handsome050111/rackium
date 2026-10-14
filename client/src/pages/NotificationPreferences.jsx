import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BellRing } from 'lucide-react'
import { notificationsApi } from '../api/workApi.js'

// Notification preferences (brief v2.2 §9; M5b): per type, in-app, email,
// both, or in-app plus a daily digest email. Saved as soon as one changes.
export default function NotificationPreferences() {
  const { orgId } = useParams()
  const [prefs, setPrefs] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)

  useEffect(() => {
    notificationsApi
      .preferences(orgId)
      .then(setPrefs)
      .catch((err) => setError(err.message))
  }, [orgId])

  const groups = useMemo(() => {
    const out = []
    for (const t of prefs?.types ?? []) {
      const g = out.find((x) => x.name === t.group)
      if (g) g.types.push(t)
      else out.push({ name: t.group, types: [t] })
    }
    return out
  }, [prefs])

  async function change(type, mode) {
    try {
      const res = await notificationsApi.updatePreferences(orgId, { [type.key]: mode })
      setPrefs(res)
      setSaved(`${type.label}: ${prefs.deliveryModes.find((m) => m.key === mode)?.label}`)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
          <BellRing size={22} strokeWidth={2} className="text-brand" />
          Notification preferences
        </h1>
        <p className="text-sm text-text-secondary">How you hear about each kind of event in this organisation. The daily digest is one email a day listing everything set to it.</p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-status-red">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-status-green">
          Saved — {saved}
        </p>
      )}
      {!prefs && !error && <p className="text-sm text-text-secondary">Loading…</p>}
      {groups.map((g) => (
        <section key={g.name} className="rounded-xl border border-border bg-surface p-3">
          <h2 className="mb-2 text-sm font-semibold text-text">{g.name}</h2>
          <ul className="space-y-2">
            {g.types.map((t) => (
              <li key={t.key} className="grid grid-cols-1 items-center gap-1 text-xs sm:grid-cols-[minmax(0,1fr)_14rem] sm:gap-3">
                <span className="text-text">{t.label}</span>
                <select aria-label={`Delivery for ${t.label}`} value={prefs.modes[t.key]} onChange={(e) => change(t, e.target.value)} className="h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none">
                  {prefs.deliveryModes.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
