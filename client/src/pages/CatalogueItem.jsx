import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Copy } from 'lucide-react'
import { ACTIONS } from '@rackium/shared/policy.js'
import { CATEGORY_LABELS, CATEGORY_GROUPS } from '@rackium/shared/catalogue.js'
import { catalogueApi } from '../api/catalogueApi.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { canIn } from '../lib/realRoles.js'
import { formatMinor } from '../lib/money.js'
import { LayerBadge, PlaceholderBadge } from '../components/catalogue/CatalogueBadges.jsx'

function Section({ title, children }) {
  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {children}
    </section>
  )
}

function Facts({ rows }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-secondary">{label}</dt>
          <dd className="text-text">{value ?? <span className="text-text-secondary">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

const yesNo = (v) => (v ? 'Yes' : 'No')
const withUnit = (v, unit) => (v == null ? null : `${v} ${unit}`)

export default function CatalogueItem() {
  const { orgId, itemId } = useParams()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('projectId')
  const { memberships } = useAuth()
  const canManage = canIn(memberships, orgId, null, ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    catalogueApi
      .get(orgId, itemId, { projectId })
      .then((r) => active && setData(r))
      .catch((err) => active && setError(err.message))
    return () => {
      active = false
    }
  }, [orgId, itemId, projectId])

  const back = `/orgs/${orgId}/catalogue${projectId ? `?projectId=${projectId}` : ''}`
  if (error) return <div className="p-6 text-sm text-status-red">{error}</div>
  // Until the response for this item arrives, the previous item's data must not show.
  if (!data || data.item?.id !== itemId) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  const { item, ports, layers, effectiveId, pricesVisible } = data
  const group = CATEGORY_GROUPS.find((g) => g.categories.includes(item.category))
  const overridden = effectiveId !== item.id

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 p-4 sm:p-6">
      <Link to={back} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        Equipment catalogue
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">
            {item.vendor} {item.model}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
            <span>
              {group?.label} · {CATEGORY_LABELS[item.category]}
            </span>
            <LayerBadge layer={item.layer} />
            {item.placeholder && <PlaceholderBadge />}
          </div>
          {item.description && <p className="mt-1 text-sm text-text-secondary">{item.description}</p>}
        </div>
        {canManage && (
          <div className="flex gap-2">
            {item.layer === 'organisation' ? (
              <Link to={`/orgs/${orgId}/catalogue/${item.id}/edit`} className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 sm:h-9">
                <Pencil size={14} strokeWidth={2} />
                Edit
              </Link>
            ) : (
              <Link
                to={`/orgs/${orgId}/catalogue/new?from=${item.id}`}
                title="Seeded items are read-only. An organisation item with the same vendor and model overrides it."
                className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand sm:h-9"
              >
                <Copy size={14} strokeWidth={2} />
                Override in organisation
              </Link>
            )}
          </div>
        )}
      </div>

      {overridden && (
        <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-text-secondary">
          A more specific layer overrides this item.{' '}
          <Link to={`/orgs/${orgId}/catalogue/${effectiveId}${projectId ? `?projectId=${projectId}` : ''}`} className="font-medium text-brand hover:underline">
            View the item in use
          </Link>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title="Physical">
          <Facts
            rows={[
              ['RU height', item.heightU == null ? null : `${item.heightU}U`],
              ['Mounting', item.rackMounted ? item.mounting : 'Not rack-mounted'],
              ['Full depth', yesNo(item.fullDepth)],
              ['Weight', withUnit(item.weightKg, 'kg')],
            ]}
          />
        </Section>
        <Section title="Power">
          <Facts
            rows={[
              ['Power draw', withUnit(item.powerDrawW, 'W')],
              ['Power inlet', item.powerInletType],
              ['PoE budget', withUnit(item.poeBudgetW, 'W')],
              ['PSU slots', item.psuCount],
            ]}
          />
        </Section>
        <Section title="Commercial">
          <Facts
            rows={[
              ['Unit price', pricesVisible ? formatMinor(item.unitPriceMinor, item.currency) ?? 'Not priced' : 'Not visible to your role'],
              ['SERVON available', yesNo(item.servonAvailable)],
              ['SERVON code', item.servonProductCode],
            ]}
          />
        </Section>
        <Section title="Lifecycle">
          <Facts
            rows={[
              ['End of sale', item.eosDate],
              ['End of life', item.eolDate],
              ['Front artwork', item.artworkFront],
              ['Rear artwork', item.artworkRear],
            ]}
          />
        </Section>
        {item.mediaSpeed && (
          <Section title="Optic">
            <Facts
              rows={[
                ['Media', item.mediaSpeed.media.toUpperCase()],
                ['Speed', item.mediaSpeed.speed],
                ['Reach', `${item.mediaSpeed.reachM} m`],
              ]}
            />
          </Section>
        )}
        <Section title="Compatible parts">
          <Facts
            rows={[
              ['SFPs / optics', item.compatibleSfps.join(', ') || null],
              ['PSUs', item.compatiblePsus.join(', ') || null],
              ['Modules', item.compatibleModules.join(', ') || null],
              ['Needs uplink module', yesNo(item.needsUplinkModule)],
              ['Requires dual PSU', yesNo(item.requiresDualPsu)],
            ]}
          />
        </Section>
      </div>

      {item.portMap && (
        <Section title={`Ports (${ports.length})`}>
          <ul className="space-y-1 text-xs text-text-secondary">
            {item.portMap.groups.map((g, i) => (
              <li key={i}>
                <span className="font-medium capitalize text-text">{g.role}</span>: {g.count} × {g.type}
                {g.speed ? ` ${g.speed}` : ''}
                {g.poe ? ' PoE' : ''} — {ports.filter((p) => p.role === g.role)[0]?.id} … {ports.filter((p) => p.role === g.role).at(-1)?.id}
              </li>
            ))}
          </ul>
          <ol aria-label="Port list" className="flex flex-wrap gap-1">
            {ports.map((p) => (
              <li key={p.id} className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${p.role === 'access' ? 'border-border text-text' : 'border-brand/40 text-brand'}`}>
                {p.id}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {layers.length > 1 && (
        <Section title="Defined in">
          <ul className="flex flex-wrap gap-2 text-xs">
            {layers.map((l) => (
              <li key={l.id} className="flex items-center gap-1">
                <LayerBadge layer={l.layer} />
                {l.id === effectiveId && <span className="text-status-green">in use</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
