import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { SEARCH_MIN } from '@rackium/shared/search.js'
import { searchApi } from '../api/m7a2Api.js'
import { groupResults } from '../lib/searchModel.js'

// The top bar's global search (brief v2.3 §6.12; M7a-2), real mode only.
// Debounced; keyboard: ↑ ↓ to move, Enter to open, Esc to close.
function SearchBox({ orgId, autoFocus = false, onDone }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const projectId = pathname.match(/^\/orgs\/[^/]+\/projects\/([a-f0-9]{24})/)?.[1] ?? null
  const [q, setQ] = useState('')
  // The answer and the query it answers: shown only while that is the query.
  const [answer, setAnswer] = useState({ text: null, results: [], failed: false })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const boxRef = useRef(null)
  const text = q.trim()
  const searchable = text.length >= SEARCH_MIN

  useEffect(() => {
    if (!searchable) return undefined
    let live = true
    const timer = setTimeout(() => {
      searchApi
        .search(orgId, text, projectId)
        .then((res) => live && setAnswer({ text, results: res.results, failed: false }))
        .catch(() => live && setAnswer({ text, results: [], failed: true }))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [text, searchable, orgId, projectId])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = searchable && answer.text === text
  const groups = useMemo(() => (current ? groupResults(answer.results) : []), [current, answer])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1))
  function go(r) {
    setOpen(false)
    setQ('')
    onDone?.()
    navigate(r.link)
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false)
      onDone?.()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive(Math.min(flat.length - 1, activeIndex + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(0, activeIndex - 1))
    } else if (e.key === 'Enter' && flat[activeIndex]) {
      e.preventDefault()
      go(flat[activeIndex])
    }
  }
  const showPanel = open && searchable

  return (
    <div className="relative w-full" ref={boxRef}>
      <Search size={18} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
      <input
        type="search"
        role="combobox"
        aria-label="Search"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && flat.length ? `${listId}-${activeIndex}` : undefined}
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search buildings, racks, hostnames, serials, MACs, cables…"
        className="h-11 w-full rounded-lg border border-border bg-surface-muted pl-10 pr-4 text-sm text-text placeholder:text-text-secondary focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg" data-testid="search-results">
          {!current && <p className="px-3 py-2 text-xs text-text-secondary">Searching…</p>}
          {current && answer.failed && <p className="px-3 py-2 text-xs text-status-red">Search is not available right now.</p>}
          {current && !answer.failed && !flat.length && <p className="px-3 py-2 text-xs text-text-secondary">Nothing found for “{text}”.</p>}
          <ul id={listId} role="listbox" aria-label="Search results">
            {groups.map((g) => (
              <li key={g.type} role="presentation">
                <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{g.label}</div>
                <ul role="presentation">
                  {g.items.map((r) => (
                    <li
                      key={`${r.type}:${r.id}:${r.projectId}`}
                      id={`${listId}-${r.index}`}
                      role="option"
                      aria-selected={r.index === activeIndex}
                      onMouseEnter={() => setActive(r.index)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        go(r)
                      }}
                      className={`cursor-pointer rounded-lg px-3 py-1.5 ${r.index === activeIndex ? 'bg-brand/10' : ''}`}
                      data-result={r.type}
                    >
                      <div className="truncate text-sm font-medium text-text">{r.title}</div>
                      <div className="truncate text-[11px] text-text-secondary">{[r.subtitle, r.projectId !== projectId ? r.projectName : null].filter(Boolean).join(' · ')}</div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Tablet and desktop: the box in the top bar.
export default function GlobalSearch({ orgId }) {
  return (
    <div className="mx-2 hidden max-w-xl flex-1 sm:block">
      <SearchBox orgId={orgId} />
    </div>
  )
}

// Phone: an icon among the top bar's buttons that opens the box below it.
export function PhoneSearch({ orgId }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-touch w-touch items-center justify-center rounded-lg text-brand sm:hidden" aria-label={open ? 'Close search' : 'Search'} aria-expanded={open}>
        {open ? <X size={20} strokeWidth={2} /> : <Search size={20} strokeWidth={2} />}
      </button>
      {open && (
        <div className="fixed inset-x-0 top-[calc(4rem+var(--env-banner-h,0px))] z-40 border-b border-border bg-surface p-3 shadow-md sm:hidden" data-testid="phone-search">
          <SearchBox orgId={orgId} autoFocus onDone={() => setOpen(false)} />
        </div>
      )}
    </>
  )
}
