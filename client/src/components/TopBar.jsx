import { Search, Bell, Settings, ChevronDown, Menu } from 'lucide-react'
import Logo from './Logo.jsx'

export default function TopBar({ onMenuClick }) {
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
        <button
          type="button"
          aria-label="Notifications"
          className="flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted"
        >
          <Bell size={20} strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Settings"
          className="flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted"
        >
          <Settings size={20} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="flex h-touch items-center gap-2 rounded-lg px-2 text-text hover:bg-surface-muted"
          aria-label="User menu"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
            KR
          </span>
          <ChevronDown size={16} strokeWidth={2} className="hidden text-text-secondary sm:block" />
        </button>
      </div>
    </header>
  )
}
