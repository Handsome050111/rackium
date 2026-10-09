import { useRef, useState } from 'react'
import { Camera, Upload, X, FileText } from 'lucide-react'
import { useSurveyMedia } from './SurveyMediaContext.js'

// Real-mode photo and file controls for survey fields (value: { fileIds }).
// Thumbnails come from the authorised API (or the local copy while a photo
// waits to upload offline). `multi`: photo_multi / gallery; otherwise one.
export function PhotoField({ label, value, editable, multi, onChange, large }) {
  const media = useSurveyMedia()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileIds = value?.fileIds ?? []

  async function handleFiles(e) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    setError(null)
    try {
      const added = await media.addFiles(multi ? files : files.slice(0, 1), { kind: 'photo' })
      const ids = added.map((a) => a.fileId)
      onChange({ fileIds: multi ? [...fileIds, ...ids] : ids })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function remove(id) {
    const rest = fileIds.filter((x) => x !== id)
    onChange(rest.length ? { fileIds: rest } : null)
  }

  const tile = large ? 'aspect-square' : 'h-14 w-14'
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {fileIds.map((id) => (
          <div key={id} className={`relative overflow-hidden rounded-lg border border-border bg-surface-muted ${tile}`}>
            <a href={media.photoUrl(id, { full: true })} target="_blank" rel="noreferrer" title="Open photo">
              <img src={media.photoUrl(id)} alt={`${label} photo`} className="h-full w-full object-cover" />
            </a>
            {editable && (
              <button type="button" onClick={() => remove(id)} aria-label="Remove photo" className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        ))}
        {editable && (multi || fileIds.length === 0) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className={`flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-medium text-text-secondary hover:border-brand/40 disabled:opacity-50 ${large ? 'aspect-square' : fileIds.length ? 'h-14 w-14' : 'h-9 w-full'}`}
          >
            <Camera size={13} strokeWidth={2} />
            {!fileIds.length && !large && (busy ? 'Adding…' : 'Add photo')}
          </button>
        )}
        {!editable && fileIds.length === 0 && <span className="flex h-9 items-center text-xs text-text-secondary">No photo</span>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple={multi} onChange={handleFiles} className="hidden" aria-label={`Add photo: ${label}`} />
      {error && <p className="mt-1 text-[11px] text-status-red">{error}</p>}
    </div>
  )
}

export function FileField({ label, value, editable, onChange }) {
  const media = useSurveyMedia()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileId = value?.fileIds?.[0]

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const [added] = await media.addFiles([file], { kind: 'document' })
      onChange({ fileIds: [added.fileId] })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex gap-1.5">
        {fileId && (
          <a href={media.fileUrl(fileId)} className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-brand hover:bg-brand/5">
            <FileText size={13} strokeWidth={2} className="shrink-0" />
            <span className="truncate">{value.fileName ?? 'Download'}</span>
          </a>
        )}
        {editable && (
          <label className={`flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-xs font-medium text-text-secondary hover:border-brand/40 ${fileId ? '' : 'w-full'}`}>
            <input type="file" accept=".pdf,.xlsx,.xls,.csv,application/pdf" onChange={handleFile} disabled={busy} className="hidden" aria-label={`Upload file: ${label}`} />
            <Upload size={13} strokeWidth={2} />
            {busy ? 'Uploading…' : fileId ? 'Replace' : 'Upload file'}
          </label>
        )}
        {!editable && !fileId && <span className="flex h-9 items-center text-xs text-text-secondary">No file</span>}
      </div>
      {error && <p className="mt-1 text-[11px] text-status-red">{error}</p>}
    </div>
  )
}
