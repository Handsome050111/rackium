import { useEffect, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'

// Local-preview-only placeholder for the later pathway map — no upload,
// no processing, just proving the slot exists.
export default function FloorPlanUpload({ disabled }) {
  const [previewUrl, setPreviewUrl] = useState(null)
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl])

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
    setOpen(true)
  }

  function handleClear() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setOpen(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="relative">
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} disabled={disabled} className="hidden" />
      <button
        type="button"
        disabled={disabled}
        onClick={() => (previewUrl ? setOpen((o) => !o) : inputRef.current?.click())}
        className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
      >
        <Upload size={14} strokeWidth={2} />
        {previewUrl ? 'Floor plan attached' : 'Import floor plan'}
      </button>

      {open && previewUrl && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <img src={previewUrl} alt="Floor plan preview" className="mb-2 w-full rounded-lg border border-border object-cover" />
          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-xs font-medium text-brand hover:underline"
            >
              Replace
            </button>
            <button type="button" onClick={handleClear} className="flex items-center gap-1 text-xs text-status-red hover:underline">
              <X size={12} strokeWidth={2} />
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
