import { useEffect, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { documentsApi, fileToDataUrl } from '../../api/documentsApi.js'

// A logo on generated documents (M6b): preview, replace, remove.
// `exists`: whether a logo is set — no image request otherwise (no 404 in the console).
export function LogoField({ label, src, exists, canEdit, onSet, onRemove }) {
  const [version, setVersion] = useState(0)
  const [missing, setMissing] = useState(!exists)
  const [error, setError] = useState(null)
  return (
    <div className="space-y-2" data-testid={`logo-${label.toLowerCase().replace(/\W+/g, '-')}`}>
      <div className="flex h-20 w-56 items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted">
        {missing ? <span className="text-xs text-text-secondary">No logo — a placeholder is printed</span> : <img key={version} src={`${src}?v=${version}`} alt={label} className="max-h-16 max-w-52 object-contain" onError={() => setMissing(true)} onLoad={() => setMissing(false)} />}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand">
            <ImagePlus size={14} strokeWidth={2} /> {missing ? 'Upload' : 'Replace'} {label.toLowerCase()}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label={`Upload ${label.toLowerCase()}`}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                if (file.size > 500 * 1024) return setError('At most 500 KB')
                try {
                  await onSet(await fileToDataUrl(file))
                  setError(null)
                  setMissing(false)
                  setVersion((v) => v + 1)
                } catch (err) {
                  setError(err.message)
                }
              }}
            />
          </label>
          {!missing && (
            <button
              type="button"
              onClick={async () => {
                await onRemove()
                setMissing(true)
              }}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-status-red"
            >
              <Trash2 size={13} strokeWidth={2} /> Remove
            </button>
          )}
        </div>
      )}
      <p className="text-[11px] text-text-secondary">PNG or JPEG, at most 500 KB.</p>
      {error && <p className="text-xs text-status-red">{error}</p>}
    </div>
  )
}

// Project Settings → Documents & branding: the client logo and the cable
// schedule's column headings (the client's SC headings; placeholders until supplied).
export default function DocumentSettingsTab({ orgId, projectId, canEdit }) {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState({})
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    documentsApi.headings(orgId, projectId).then((d) => {
      setData(d)
      setDraft(d.custom ?? {})
    })
  }, [orgId, projectId])
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">Client logo</h2>
        <p className="text-xs text-text-secondary">Printed on the cover of every generated document, beside the organisation's logo.</p>
        {data && <LogoField label="Client logo" exists={data.hasClientLogo} src={documentsApi.clientLogoUrl(orgId, projectId)} canEdit={canEdit} onSet={(uri) => documentsApi.setClientLogo(orgId, projectId, uri)} onRemove={() => documentsApi.removeClientLogo(orgId, projectId)} />}
      </section>
      <section className="space-y-2" aria-label="Cable schedule headings">
        <h2 className="text-sm font-semibold text-text">Cable schedule column headings</h2>
        <p className="text-xs text-text-secondary">The client's own (SC) headings for the cable schedule export. Leave a field empty to keep the placeholder.</p>
        {data && (
          <form
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                const out = await documentsApi.setHeadings(orgId, projectId, Object.fromEntries(data.keys.map((k) => [k, draft[k] ?? ''])))
                setData(out)
                setNotice('Headings saved')
                setError(null)
              } catch (err) {
                setError(err.message)
              }
            }}
          >
            {data.keys.map((k) => (
              <label key={k} className="text-xs text-text-secondary">
                {data.headings[k] !== draft[k] && draft[k] ? <span className="text-text">{draft[k]}</span> : data.headings[k]}
                <input disabled={!canEdit} placeholder={data.headings[k]} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} aria-label={`Heading for ${k}`} className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm text-text disabled:bg-surface-muted" />
              </label>
            ))}
            {canEdit && (
              <div className="sm:col-span-3">
                <button type="submit" className="h-9 rounded-lg bg-brand px-4 text-xs font-medium text-white">
                  Save headings
                </button>
              </div>
            )}
          </form>
        )}
        {notice && <p className="text-xs text-status-green" role="status">{notice}</p>}
        {error && <p className="text-xs text-status-red" role="alert">{error}</p>}
      </section>
    </div>
  )
}
