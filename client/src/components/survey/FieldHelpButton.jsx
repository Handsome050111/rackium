import { useContext, useEffect, useId, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'
import { HELP_PARTS } from '@rackium/shared/fieldHelp.js'
import { FieldKeyContext, useFieldHelp } from '../../lib/fieldHelpContext.js'

// The ⓘ next to a field label (brief v2.2 §18; M7a-2): what the field means,
// what to look for, an example, common mistakes and reference photos. Every
// text is rendered as text (React escapes it) — never as HTML. Keyboard and
// touch: a button; Esc or ✕ closes and returns focus.
export default function FieldHelpButton({ fieldKey = null, label }) {
  const contextKey = useContext(FieldKeyContext)
  const help = useFieldHelp(fieldKey ?? contextKey)
  const [open, setOpen] = useState(false)
  // Fixed to the viewport (a table header scrolls and would clip it).
  const [pos, setPos] = useState(null)
  const id = useId()
  const buttonRef = useRef(null)
  const panelRef = useRef(null)

  // Under the button, or above it in the lower part of the screen; within the viewport.
  function placement() {
    const rect = buttonRef.current.getBoundingClientRect()
    const width = Math.min(288, window.innerWidth - 16)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    return rect.bottom < window.innerHeight * 0.55 ? { top: rect.bottom + 4, left, width, maxHeight: window.innerHeight - rect.bottom - 12 } : { bottom: window.innerHeight - rect.top + 4, left, width, maxHeight: rect.top - 12 }
  }

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onDown = (e) => panelRef.current && !panelRef.current.contains(e.target) && !buttonRef.current?.contains(e.target) && setOpen(false)
    // A scroll (the page, a table) or a resize moves the button: the help follows it.
    // (A resize comes from the window, not an element.)
    const onMove = (e) => !(e.target instanceof Node && panelRef.current?.contains(e.target)) && buttonRef.current && setPos(placement())
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  if (!help) return null
  return (
    <span className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Help: ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setPos(placement())
          setOpen((o) => !o)
        }}
        className="flex h-5 w-5 items-center justify-center rounded-full text-text-secondary hover:bg-surface-muted hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        data-testid="field-help-button"
      >
        <Info size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && pos && (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={`Help: ${label}`}
          onClick={(e) => e.preventDefault()}
          style={pos}
          className="fixed z-50 overflow-y-auto whitespace-normal rounded-xl border border-border bg-surface p-3 text-left text-xs font-normal normal-case tracking-normal text-text shadow-lg"
          data-testid="field-help"
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <span className="font-semibold">{label}</span>
            <button type="button" aria-label="Close help" onClick={() => setOpen(false)} className="text-text-secondary hover:text-text">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          {help.placeholder && <p className="mb-1.5 rounded bg-surface-muted px-2 py-1 text-[11px] text-text-secondary">Placeholder text — the final help for this field is still to come.</p>}
          <dl className="space-y-1.5">
            {HELP_PARTS.filter((p) => help[p.key]).map((p) => (
              <div key={p.key}>
                <dt className="text-[11px] font-semibold text-text-secondary">{p.label}</dt>
                <dd className="whitespace-pre-line break-words">{help[p.key]}</dd>
              </div>
            ))}
          </dl>
          {help.photos?.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {help.photos.map((ph) => (
                <figure key={ph.id}>
                  <img src={ph.url} alt={ph.caption ?? `Reference photo for ${label}`} className="aspect-[4/3] w-full rounded object-cover" loading="lazy" />
                  {ph.caption && <figcaption className="mt-0.5 truncate text-[10px] text-text-secondary">{ph.caption}</figcaption>}
                </figure>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  )
}
