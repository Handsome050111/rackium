import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Search, Settings, ChevronDown, Menu, FlaskConical, Check, WifiOff, Wifi, RotateCcw, Map } from 'lucide-react'
import Logo from './Logo.jsx'
import NotificationsPanel from './NotificationsPanel.jsx'
import { useRole } from '../lib/RoleContext.jsx'
import { ROLES } from '../lib/permissions.js'
import { useOffline } from '../lib/OfflineContext.jsx'
import { useAuth } from '../lib/AuthContext.jsx'

const initialsOf = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?'
import { resetDemoData } from '../lib/persistentStore.js'

function UserMenu() {
  const { role, setRole } = useRole()
  const { isOffline, setOffline, pendingCount, syncing } = useOffline()
  const { user, mode, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const currentRole = ROLES.find((r) => r.id === role)

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
        onClick={() => setOpen((o) => !o)}
        className="flex h-touch items-center gap-2 rounded-lg px-2 text-text hover:bg-surface-muted"
        aria-label="User menu"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
          {initialsOf(user?.name)}
        </span>
        <ChevronDown size={16} strokeWidth={2} className="hidden text-text-secondary sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <div className="px-2 py-1.5 text-sm font-medium text-text">{user?.name}</div>
          <div className="mx-2 my-1 border-t border-border" />

          <div className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-status-amber">
            <FlaskConical size={12} strokeWidth={2} />
            Demo controls — not part of the real product
          </div>
          <div className="px-2 pb-1.5 text-xs text-text-secondary">
            View as role (gates actions per v2.3 §4.3):
          </div>
          <div className="space-y-0.5">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setRole(r.id)
                  setOpen(false)
                }}
                className={`flex h-touch w-full items-center justify-between rounded-lg px-2 text-sm sm:h-8 ${
                  r.id === role ? 'bg-brand/10 font-medium text-brand' : 'text-text hover:bg-surface-muted'
                }`}
              >
                {r.label}
                {r.id === role && <Check size={14} strokeWidth={2} />}
              </button>
            ))}
          </div>
          <div className="mt-1 px-2 text-[11px] text-text-secondary">Currently viewing as {currentRole?.label}.</div>

          <div className="mx-2 my-1 border-t border-border" />
          <div className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-status-amber">
            <FlaskConical size={12} strokeWidth={2} />
            Simulate offline (survey, §5.2)
          </div>
          <button
            type="button"
            aria-label="Toggle offline simulation"
            onClick={() => setOffline(!isOffline)}
            className="flex h-touch w-full items-center justify-between rounded-lg px-2 text-sm text-text hover:bg-surface-muted sm:h-8"
          >
            <span className="flex items-center gap-2">
              {isOffline ? <WifiOff size={14} strokeWidth={2} className="text-status-red" /> : <Wifi size={14} strokeWidth={2} className="text-status-green" />}
              {isOffline ? 'Offline' : 'Online'}
            </span>
            {isOffline && pendingCount > 0 && <span className="rounded-full bg-status-amber/10 px-1.5 text-[11px] font-medium text-status-amber">{pendingCount} pending</span>}
            {!isOffline && syncing && <span className="text-[11px] text-text-secondary">Syncing…</span>}
          </button>

          {mode === 'real' && (
            <Link to="/team" onClick={() => setOpen(false)} className="flex h-touch w-full items-center gap-2 rounded-lg px-2 text-sm text-text hover:bg-surface-muted sm:h-8">
              Team
            </Link>
          )}
          {mode === 'real' && (
            <button type="button" onClick={() => { setOpen(false); signOut() }} className="flex h-touch w-full items-center rounded-lg px-2 text-sm text-text hover:bg-surface-muted sm:h-8">
              Sign out
            </button>
          )}
          <div className="mx-2 my-1 border-t border-border" />
          <Link
            to="/demo-guide"
            onClick={() => setOpen(false)}
            className="flex h-touch w-full items-center gap-2 rounded-lg px-2 text-sm text-text hover:bg-surface-muted sm:h-8"
          >
            <Map size={14} strokeWidth={2} />
            Demo guide
          </Link>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Reset all demo data back to the original seed? This discards every change made in this browser.')) {
                resetDemoData()
              }
            }}
            className="flex h-touch w-full items-center gap-2 rounded-lg px-2 text-sm text-status-red hover:bg-status-red/5 sm:h-8"
          >
            <RotateCcw size={14} strokeWidth={2} />
            Reset demo data
          </button>
        </div>
      )}
    </div>
  )
}

export default function TopBar({ onMenuClick }) {
  const { buildingId = 'b001' } = useParams()
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-touch w-touch items-center justify-center rounded-lg text-brand sm:hidden"
        aria-label="Open menu"
      >
        <Menu size={22} strokeWidth={2} />
      </button>

      <Logo className="shrink-0" />

      <div className="relative mx-2 hidden max-w-xl flex-1 sm:block">
        <Search
          size={18}
          strokeWidth={2}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
        />
        <input
          type="search"
          placeholder="Search sites, buildings, rooms…"
          className="h-11 w-full rounded-lg border border-border bg-surface-muted pl-10 pr-4 text-sm text-text placeholder:text-text-secondary focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <NotificationsPanel />
        <Link
          to={`/b/${buildingId}/settings`}
          aria-label="Settings"
          className="flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted"
        >
          <Settings size={20} strokeWidth={2} />
        </Link>
        <UserMenu />
      </div>
    </header>
  )
}
