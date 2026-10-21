import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { HELP_PARTS, HELP_TEXT_MAX, HELP_PHOTOS_MAX } from '@rackium/shared/fieldHelp.js'
import { fieldHelpApi } from '../api/m7a2Api.js'
import { invalidateFieldHelp } from '../lib/fieldHelpContext.js'

const inputClass = 'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'
const btn = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-50'

function statusOf(f) {
  if (!f.help) return { label: 'No help yet', cls: 'text-text-secondary' }
  if (f.help.placeholder) return { label: 'Placeholder (default)', cls: 'text-status-amber' }
  return { label: 'Organisation text', cls: 'text-status-green' }
}

// One field's help: the organisation's four texts (plain text) over the
// default, and its reference photos.
function Editor({ orgId, field, onSaved }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(HELP_PARTS.map((p) => [p.key, field.own?.[p.key] ?? ''])))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [caption, setCaption] = useState('')
  const photos = field.help?.photos ?? []
  async function act(fn, done) {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      invalidateFieldHelp(orgId)
      setMessage({ ok: true, text: done })
      await onSaved()
    } catch (err) {
      setMessage({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }
  const save = () => act(() => fieldHelpApi.update(orgId, field.key, Object.fromEntries(HELP_PARTS.map((p) => [p.key, draft[p.key].trim() ? draft[p.key] : null]))), 'Saved')
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-surface-muted/40 p-3" data-testid="field-help-editor">
      {HELP_PARTS.map((p) => (
        <label key={p.key} className="block space-y-1">
          <span className="text-[11px] font-semibold text-text-secondary">{p.label}</span>
          <textarea
            rows={p.key === 'example' ? 1 : 2}
            maxLength={HELP_TEXT_MAX}
            aria-label={`${field.label}: ${p.label}`}
            value={draft[p.key]}
            placeholder={field.own?.[p.key] ? '' : field.help?.[p.key] ? `Default: ${field.help[p.key]}` : ''}
            onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.value }))}
            className={inputClass}
          />
        </label>
      ))}
      <p className="text-[11px] text-text-secondary">Plain text only — anything typed is shown exactly as written.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={save} className={`${btn} bg-brand text-white`}>
          Save help
        </button>
        <button type="button" disabled={busy || !field.own || HELP_PARTS.every((p) => !field.own[p.key])} onClick={() => act(() => fieldHelpApi.reset(orgId, field.key), 'Back to the default')} className={`${btn} border border-border text-text`}>
          Use the default text
        </button>
      </div>
      <div className="space-y-1.5 border-t border-border pt-2">
        <span className="text-[11px] font-semibold text-text-secondary">
          Reference photos ({photos.length}/{HELP_PHOTOS_MAX}) — JPG, PNG or WebP; location and camera data are removed
        </span>
        {photos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {photos.map((ph) => (
              <li key={ph.id} className="relative">
                <img src={ph.url} alt={ph.caption ?? 'Reference photo'} className="h-16 w-24 rounded object-cover" />
                <button type="button" aria-label={`Remove photo ${ph.caption ?? ''}`.trim()} disabled={busy} onClick={() => act(() => fieldHelpApi.removePhoto(orgId, field.key, ph.id), 'Photo removed')} className="absolute right-0.5 top-0.5 rounded bg-surface/90 p-0.5 text-status-red">
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {photos.length < HELP_PHOTOS_MAX && (
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Photo caption" maxLength={200} placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} className={`${inputClass} h-9 w-48`} />
            <label className={`${btn} cursor-pointer border border-border text-text`}>
              <Upload size={14} aria-hidden="true" />
              Add photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Add reference photo"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) act(() => fieldHelpApi.addPhoto(orgId, field.key, file, caption.trim() || null), 'Photo added').then(() => setCaption(''))
                }}
              />
            </label>
          </div>
        )}
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-xs ${message.ok ? 'text-status-green' : 'text-status-red'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}

// Org Admin: the help shown behind each ⓘ of the survey forms (v2.2 §18).
export default function FieldHelpSection({ orgId }) {
  const [fields, setFields] = useState(null)
  const [tab, setTab] = useState('')
  const [filter, setFilter] = useState('')
  const [openKey, setOpenKey] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    try {
      setFields((await fieldHelpApi.list(orgId)).fields)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [orgId])
  useEffect(() => {
    let live = true
    fieldHelpApi
      .list(orgId)
      .then((r) => live && setFields(r.fields))
      .catch((err) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [orgId])
  const tabs = useMemo(() => [...new Set((fields ?? []).map((f) => f.tab))], [fields])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (fields ?? []).filter((f) => (!tab || f.tab === tab) && (!q || f.label.toLowerCase().includes(q)))
  }, [fields, tab, filter])
  if (error) return <p className="text-xs text-status-red">{error}</p>
  if (!fields) return <p className="text-xs text-text-secondary">Loading…</p>
  const placeholders = fields.filter((f) => f.help?.placeholder).length
  return (
    <div className="space-y-2" data-testid="field-help-admin">
      <p className="text-xs text-text-secondary">
        {fields.length} survey fields; {placeholders} show placeholder help from the survey template until the final texts arrive.
      </p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Survey tab" value={tab} onChange={(e) => setTab(e.target.value)} className={`${inputClass} h-9 w-auto`}>
          <option value="">Every tab</option>
          {tabs.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input type="search" aria-label="Find a field" placeholder="Find a field" value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputClass} h-9 w-48`} />
      </div>
      <ul className="max-h-[480px] divide-y divide-border/60 overflow-y-auto rounded-lg border border-border">
        {shown.slice(0, 200).map((f) => {
          const s = statusOf(f)
          return (
            <li key={f.key} className="px-3 py-2" data-field={f.key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-xs font-medium text-text">{f.label}</span>
                  <span className="text-[11px] text-text-secondary"> · {f.tab}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`text-[11px] ${s.cls}`}>{s.label}</span>
                  <button type="button" onClick={() => setOpenKey(openKey === f.key ? null : f.key)} aria-expanded={openKey === f.key} className="text-xs font-medium text-brand hover:underline">
                    {openKey === f.key ? 'Close' : 'Edit'}
                  </button>
                </span>
              </div>
              {openKey === f.key && (
                <div className="mt-2">
                  <Editor key={f.key} orgId={orgId} field={f} onSaved={load} />
                </div>
              )}
            </li>
          )
        })}
        {shown.length === 0 && <li className="px-3 py-2 text-xs text-text-secondary">No field matches.</li>}
      </ul>
    </div>
  )
}
