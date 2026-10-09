import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { filesApi } from '../../api/filesApi.js'
import { useRealSurveySync } from '../../lib/RealSurveySync.jsx'

// Real-mode evidence photos of a room, rack or pathway (brief §5.2):
// compressed in the browser, uploaded resumably, shown from the authorised
// thumbnail endpoint. A photo taken offline shows its local copy and
// uploads on reconnect.
export default function PhotoStrip({ orgId, projectId, attachedTo, editable, label = 'Evidence photo' }) {
  const { addPhoto, photoUrl, revision } = useRealSurveySync()
  const [files, setFiles] = useState([])
  const [local, setLocal] = useState([]) // queued, not uploaded yet
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const key = `${attachedTo.type}:${attachedTo.id}`

  const load = useCallback(async () => {
    try {
      const { files: list } = await filesApi.list(orgId, projectId, attachedTo)
      setFiles(list)
      setLocal((prev) => prev.filter((id) => !list.some((f) => f.id === id)))
    } catch (err) {
      setError(err.message)
    }
    // attachedTo is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, projectId, key])

  useEffect(() => {
    load()
  }, [load, revision])

  async function handleFiles(e) {
    const picked = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!picked.length) return
    setBusy(true)
    setError(null)
    try {
      for (const file of picked) {
        const { fileId } = await addPhoto(file, { attachedTo, category: 'photo_reference' })
        setLocal((prev) => [...prev, fileId])
      }
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    try {
      await filesApi.remove(orgId, projectId, id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const ids = [...files.map((f) => f.id), ...local.filter((id) => !files.some((f) => f.id === id))]
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <div key={id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border bg-surface-muted">
            <a href={photoUrl(id, { full: true })} target="_blank" rel="noreferrer" title="Open photo">
              <img src={photoUrl(id)} alt={label} className="h-full w-full object-cover" />
            </a>
            {editable && files.some((f) => f.id === id) && (
              <button type="button" onClick={() => remove(id)} aria-label="Remove photo" className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        ))}
        {editable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border text-[10px] font-medium text-text-secondary hover:border-brand/40 disabled:opacity-50"
          >
            <Camera size={16} strokeWidth={2} />
            {busy ? 'Adding…' : 'Add'}
          </button>
        )}
        {!editable && ids.length === 0 && <span className="text-xs text-text-secondary">No photos yet.</span>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" aria-label={`Add photo: ${label}`} />
      {error && <p className="mt-1 text-[11px] text-status-red">{error}</p>}
    </div>
  )
}
