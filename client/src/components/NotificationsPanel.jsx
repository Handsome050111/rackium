import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
]

// Notifications come in M5. Until then the panel opens with an empty state,
// so the control is real but there is nothing to show yet.
export default function NotificationsPanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('all')
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted"
      >
        <Bell size={20} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications panel"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-2 shadow-lg"
        >
          <div role="tablist" aria-label="Notification filter" className="flex gap-1 border-b border-border pb-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`h-8 rounded-lg px-3 text-sm ${
                  tab === t.id ? 'bg-brand/10 font-medium text-brand' : 'text-text-secondary hover:bg-surface-muted'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="px-2 py-6 text-center text-sm text-text-secondary">No notifications yet</p>
        </div>
      )}
    </div>
  )
}
