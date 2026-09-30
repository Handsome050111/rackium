import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'

// Photos are evidence only — stored as a local object URL, never uploaded
// or analysed. No OCR, no computer vision, no confidence scores (brief
// v2.3 D08/D07).
function EvidenceSlot({ label, disabled }) {
  const [previewUrl, setPreviewUrl] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl])

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
  }

  function handleClear(e) {
    e.stopPropagation()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      className="relative flex h-24 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-dashed border-border bg-surface-muted text-text-secondary hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} disabled={disabled} className="hidden" />
      {previewUrl ? (
        <>
          <img src={previewUrl} alt={label} className="absolute inset-0 h-full w-full object-cover" />
          <span className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-[10px] font-medium text-white">{label}</span>
          {!disabled && (
            <span
              role="button"
              onClick={handleClear}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
            >
              <X size={12} strokeWidth={2} />
            </span>
          )}
        </>
      ) : (
        <>
          <Camera size={18} strokeWidth={2} />
          <span className="text-[11px] font-medium">{label}</span>
        </>
      )}
    </button>
  )
}

// A row of labeled local-preview-only photo slots. Reused for rack evidence
// (Front/Rear/PDU-UPS), room evidence, and building-connection evidence.
export default function EvidenceSlots({ labels, disabled }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((label) => (
        <EvidenceSlot key={label} label={label} disabled={disabled} />
      ))}
    </div>
  )
}
