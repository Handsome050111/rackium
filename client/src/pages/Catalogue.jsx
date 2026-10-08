import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Plus, Upload, Search, AlertTriangle } from 'lucide-react'
import { ACTIONS } from '@rackium/shared/policy.js'
import { CATEGORY_GROUPS, CATEGORY_LABELS, totalPortCount, itemHasPoe } from '@rackium/shared/catalogue.js'
import { catalogueApi } from '../api/catalogueApi.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { canIn } from '../lib/realRoles.js'
import { formatMinor } from '../lib/money.js'
import { LayerBadge, PlaceholderBadge } from '../components/catalogue/CatalogueBadges.jsx'
import CatalogueImportPanel from '../components/catalogue/CatalogueImportPanel.jsx'

const SPEEDS = ['1G', '2.5G', '10G', '25G', '40G', '100G']
const inputClass = 'h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-text focus:border-brand focus:outline-none'

// Equipment catalogue (brief v2.3 §6.5, v2.2 §6.1 progressive search):
// browse the effective catalogue — seeded, SERVON, organisation and, when
// opened from a project, that project's layer. Org Admin adds, edits and
// imports organisation items.
export default function Catalogue() {
  const { orgId } = useParams()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('projectId')
  const { memberships } = useAuth()
  const canManage = canIn(memberships, orgId, null, ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)

  const [filters, setFilters] = useState({ q: '', group: '', category: '', vendor: '', minPorts: '', poe: false, speed: '' })
  const [query, setQuery] = useState(filters)
  const [data, setData] = useState(null)
  const [orgItems, setOrgItems] = useState([])
  const [error, setError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Free text waits for typing to pause; the other filters apply at once.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(filters), filters.q === query.q ? 0 : 250)
    return () => clearTimeout(timer)
  }, [filters, query.q])

  useEffect(() => {
    let active = true
    catalogueApi
      .list(orgId, { ...query, projectId })
      .then((r) => {
        if (!active) return
        setData(r)
        setError(null)
      })
      .catch((err) => active && setError(err.message))
    return () => {
      active = false
    }
  }, [orgId, projectId, query, reloadKey])

  // The organisation layer, unfiltered, so the CSV preview can tell a new
  // item from an update.
  useEffect(() => {
    if (!canManage) return undefined
    let active = true
    catalogueApi.list(orgId).then((r) => active && setOrgItems(r.items.filter((i) => i.layer === 'organisation')))
    return () => {
      active = false
    }
  }, [orgId, canManage, reloadKey])

  const categories = useMemo(() => (filters.group ? CATEGORY_GROUPS.find((g) => g.key === filters.group).categories : CATEGORY_GROUPS.flatMap((g) => g.categories)), [filters.group])
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }))
  const itemLink = (id) => `/orgs/${orgId}/catalogue/${id}${projectId ? `?projectId=${projectId}` : ''}`
  const hasPlaceholders = data?.items.some((i) => i.placeholder)

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Equipment catalogue</h1>
          <p className="text-sm text-text-secondary">
            {data ? `${data.items.length} of ${data.total} items` : 'Loading…'}
            {projectId ? ' · including this project’s items' : ''}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setImporting((v) => !v)}
              className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand sm:h-9"
            >
              <Upload size={14} strokeWidth={2} />
              Import CSV
            </button>
            <Link to={`/orgs/${orgId}/catalogue/new`} className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 sm:h-9">
              <Plus size={14} strokeWidth={2} />
              Add item
            </Link>
          </div>
        )}
      </div>

      {hasPlaceholders && (
        <p className="flex items-start gap-2 rounded-lg border border-status-amber/30 bg-status-amber/5 px-3 py-2 text-xs text-text-secondary">
          <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-status-amber" />
          Seeded items marked Placeholder are the prototype’s models, carried over until the supplied catalogue replaces them. Unknown values are left empty.
        </p>
      )}

      {importing && canManage && (
        <CatalogueImportPanel
          orgId={orgId}
          existingItems={orgItems}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false)
            setReloadKey((k) => k + 1)
          }}
        />
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">Search the catalogue</span>
          <Search size={14} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input type="search" placeholder="Search model, vendor, description…" value={filters.q} onChange={(e) => set({ q: e.target.value })} className={`${inputClass} w-full pl-8`} />
        </label>
        <select aria-label="Category group" value={filters.group} onChange={(e) => set({ group: e.target.value, category: '' })} className={inputClass}>
          <option value="">All groups</option>
          {CATEGORY_GROUPS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>
        <select aria-label="Category" value={filters.category} onChange={(e) => set({ category: e.target.value })} className={inputClass}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select aria-label="Vendor" value={filters.vendor} onChange={(e) => set({ vendor: e.target.value })} className={inputClass}>
          <option value="">All vendors</option>
          {(data?.vendors ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input aria-label="Minimum ports" type="number" min="1" placeholder="Min. ports" value={filters.minPorts} onChange={(e) => set({ minPorts: e.target.value })} className={`${inputClass} w-24`} />
        <select aria-label="Speed" value={filters.speed} onChange={(e) => set({ speed: e.target.value })} className={inputClass}>
          <option value="">Any speed</option>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex h-9 items-center gap-1.5 text-xs text-text">
          <input type="checkbox" checked={filters.poe} onChange={(e) => set({ poe: e.target.checked })} />
          PoE
        </label>
      </div>

      {error && <p className="text-sm text-status-red">{error}</p>}

      {data && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-text-secondary">
                {['Model', 'Category', 'RU', 'Ports', 'PoE', 'Source', ...(data.pricesVisible ? ['Unit price'] : []), 'SERVON'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-text-secondary">
                    No items match these filters.
                  </td>
                </tr>
              )}
              {data.items.map((item) => (
                <tr key={item.id} className="border-b border-border/60 last:border-0 hover:bg-surface-muted/50">
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link to={itemLink(item.id)} className="font-medium text-brand hover:underline">
                      {item.vendor} {item.model}
                    </Link>
                    {item.description && <div className="max-w-72 truncate text-[11px] text-text-secondary">{item.description}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{CATEGORY_LABELS[item.category]}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{item.mounting === '0U' ? '0U' : item.heightU ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{totalPortCount(item) || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{itemHasPoe(item) ? 'Yes' : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="flex gap-1">
                      <LayerBadge layer={item.layer} />
                      {item.placeholder && <PlaceholderBadge />}
                    </span>
                  </td>
                  {data.pricesVisible && <td className="whitespace-nowrap px-3 py-2 text-text">{formatMinor(item.unitPriceMinor, item.currency) ?? <span className="text-status-amber">Not priced</span>}</td>}
                  <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{item.servonAvailable ? item.servonProductCode ?? 'Yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
