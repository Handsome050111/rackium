import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Settings } from 'lucide-react'
import { groupByDay } from '@rackium/shared/notifications.js'
import { formatDateTime } from '@rackium/shared/time.js'
import { notificationsApi } from '../api/workApi.js'

const MOCK_TABS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
]
const REAL_TABS = [...MOCK_TABS, { id: 'mentions', label: 'Mentions' }]
const POLL_MS = 60000

// The bell. Mock mode (no `orgId`): the prototype's empty panel, unchanged.
// Real mode (M5b): the signed-in user's notifications in the organisation —
// unread count on the bell, All / Unread / Mentions, grouped by day, mark one
// (by opening it) or all read; each links to its source.
export default function NotificationsPanel({ orgId = null }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('all')
  const [data, setData] = useState(null)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState(null)
  const menuRef = useRef(null)
  const navigate = useNavigate()
  const real = Boolean(orgId)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // The unread count, kept fresh while the app is open.
  useEffect(() => {
    if (!real) return
    let active = true
    const poll = () =>
      notificationsApi
        .unreadCount(orgId)
        .then((r) => active && setUnread(r.unread))
        .catch(() => {})
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [real, orgId])

  const load = useCallback(
    async (before = null) => {
      try {
        const res = await notificationsApi.list(orgId, { tab, before })
        setData((d) => (before && d ? { ...res, items: [...d.items, ...res.items] } : res))
        setUnread(res.unread)
        setError(null)
      } catch (err) {
        setError(err.message)
      }
    },
    [orgId, tab]
  )
  useEffect(() => {
    if (real && open) load()
  }, [real, open, load])

  async function openItem(n) {
    try {
      if (!n.read) await notificationsApi.markRead(orgId, n.id)
    } catch {
      // opening the source matters more than the read mark
    }
    setOpen(false)
    if (n.link) navigate(n.link)
    else load()
  }
  async function markAll() {
    await notificationsApi.markAllRead(orgId)
    await load()
  }

  const tabs = real ? REAL_TABS : MOCK_TABS
  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label={real && unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted"
      >
        <Bell size={20} strokeWidth={2} />
        {real && unread > 0 && (
          <span data-testid="unread-count" className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-red px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications panel"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-2 shadow-lg sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <div role="tablist" aria-label="Notification filter" className="flex gap-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`h-8 rounded-lg px-3 text-sm ${tab === t.id ? 'bg-brand/10 font-medium text-brand' : 'text-text-secondary hover:bg-surface-muted'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {real && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={markAll} disabled={!unread} title="Mark all read" aria-label="Mark all read" className="flex h-8 w-8 items-center justify-center rounded-lg text-brand hover:bg-surface-muted disabled:text-text-secondary">
                  <CheckCheck size={16} strokeWidth={2} />
                </button>
                <Link to={`/orgs/${orgId}/notifications/preferences`} onClick={() => setOpen(false)} title="Notification preferences" aria-label="Notification preferences" className="flex h-8 w-8 items-center justify-center rounded-lg text-brand hover:bg-surface-muted">
                  <Settings size={16} strokeWidth={2} />
                </Link>
              </div>
            )}
          </div>
          {!real && <p className="px-2 py-6 text-center text-sm text-text-secondary">No notifications yet</p>}
          {real && error && <p className="px-2 py-3 text-xs text-status-red">{error}</p>}
          {real && !data && !error && <p className="px-2 py-6 text-center text-sm text-text-secondary">Loading…</p>}
          {real && data && data.items.length === 0 && <p className="px-2 py-6 text-center text-sm text-text-secondary">{tab === 'unread' ? 'Nothing unread' : tab === 'mentions' ? 'No mentions yet' : 'No notifications yet'}</p>}
          {real && data && data.items.length > 0 && (
            <div className="max-h-[min(28rem,70vh)] overflow-y-auto pt-1" data-testid="notification-list">
              {groupByDay(data.items, new Date(), data.timeZone).map((g) => (
                <div key={g.key}>
                  <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{g.label}</div>
                  <ul>
                    {g.items.map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => openItem(n)} className={`flex w-full gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-muted ${n.read ? '' : 'bg-brand/5'}`} data-testid="notification">
                          <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand'}`} />
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm ${n.read ? 'text-text' : 'font-medium text-text'}`}>{n.title}</span>
                            {n.body && <span className="block truncate text-xs text-text-secondary">{n.body}</span>}
                            <span className="block text-[11px] text-text-secondary">
                              {formatDateTime(n.createdAt)}
                              {n.actorName ? ` · ${n.actorName}` : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {data.nextBefore && (
                <button type="button" onClick={() => load(data.nextBefore)} className="mt-1 w-full rounded-lg py-2 text-xs font-medium text-brand hover:bg-surface-muted">
                  Show older
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
