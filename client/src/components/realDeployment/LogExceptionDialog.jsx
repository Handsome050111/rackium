import { useState } from 'react'
import { Upload, X } from 'lucide-react'

// The Field Engineer logs a detected difference instead of correcting it:
// designed vs installed (detected), a reason and optional photos.
export default function LogExceptionDialog({ target, deviceName, onUpload, onSubmit, onClose }) {
  const [reason, setReason] = useState('')
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { deviation } = target
  async function add(file) {
    if (!file) return
    setBusy(true)
    try {
      const saved = await onUpload(file)
      setPhotos((p) => [...p, saved])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function submit() {
    setBusy(true)
    try {
      await onSubmit({ deviceId: target.deviceId, connectionId: target.connectionId, field: deviation.field, reason: reason.trim(), photoFileIds: photos.map((p) => p.id) })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="Log exception">
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-surface p-4 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-text">Log exception</h2>
          <button type="button" className="flex h-touch w-11 items-center justify-center rounded-lg text-text-secondary" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="rounded-lg bg-surface-muted p-3 text-sm">
          <div className="font-semibold text-text">
            {deviceName} · {deviation.label}
          </div>
          <div className="text-text-secondary">
            Designed <strong className="text-text">{deviation.designedValue}</strong>, installed <strong className="text-text">{deviation.installedValue}</strong>
          </div>
        </div>
        <label className="block text-xs text-text-secondary">
          Reason
          <textarea className="mt-1 min-h-24 w-full rounded-lg border border-border bg-surface p-2 text-sm text-text focus:border-brand focus:outline-none" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <label className="inline-flex h-touch cursor-pointer items-center gap-1 rounded-lg border border-border px-3 text-sm text-text">
            <Upload size={16} strokeWidth={2} /> Photo
            <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Add exception photo" onChange={(e) => add(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
          </label>
          {photos.map((p) => p.fileName).join(', ')}
        </div>
        {error && <p className="text-sm text-status-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="h-touch rounded-lg border border-border px-4 text-sm text-text" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="h-touch rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !reason.trim()} onClick={submit}>
            Log exception
          </button>
        </div>
      </div>
    </div>
  )
}
