import { Image, Plus, Minus } from 'lucide-react'
import { useSurveyMedia } from './SurveyMediaContext.js'
import { PhotoField } from './PhotoField.jsx'

// Reference Images: a single photo_multi field, shown as a real photo
// gallery grid rather than one generic FormField button (brief: "no
// structured fields" — the whole tab is this one gallery).
export default function GallerySection({ section, record, editable, onFieldChange }) {
  const field = section.fields[0]
  const count = record?.[field.key]?.count ?? 0
  const media = useSurveyMedia()

  // Real mode: the actual photos.
  if (media) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 text-sm font-semibold text-text">{section.section}</div>
        <div className="[&>div>div]:grid [&>div>div]:grid-cols-3 sm:[&>div>div]:grid-cols-4 lg:[&>div>div]:grid-cols-6">
          <PhotoField label={field.label} value={record?.[field.key]} editable={editable} multi large onChange={(v) => onFieldChange(field.key, v)} />
        </div>
        <div className="mt-2 text-[11px] text-text-secondary">{count} image(s)</div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 text-sm font-semibold text-text">{section.section}</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex aspect-square items-center justify-center rounded-lg border border-border bg-surface-muted text-text-secondary">
            <Image size={20} strokeWidth={1.5} />
          </div>
        ))}
        {editable && (
          <button
            type="button"
            onClick={() => onFieldChange(field.key, { count: count + 1 })}
            className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-text-secondary hover:border-brand/40"
          >
            <Plus size={18} strokeWidth={2} />
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-text-secondary">
        <span>{count} image(s)</span>
        {editable && count > 0 && (
          <button type="button" onClick={() => onFieldChange(field.key, { count: count - 1 })} className="flex items-center gap-1 text-text-secondary hover:text-status-red">
            <Minus size={11} strokeWidth={2} />
            Remove last
          </button>
        )}
      </div>
    </div>
  )
}
