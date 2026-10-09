import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { ACTIONS } from '@rackium/shared/policy.js'
import { catalogueItemSchema, expandPortMap, CATEGORY_GROUPS, CATEGORY_LABELS, CATALOGUE_KINDS, MOUNTINGS, PORT_ROLES, OPTIC_MEDIA } from '@rackium/shared/catalogue.js'
import { catalogueApi } from '../api/catalogueApi.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { canIn } from '../lib/realRoles.js'
import { parseToMinor } from '../lib/money.js'

const KIND_LABEL = { device_model: 'Device model', optic: 'Optic', stock_cable: 'Stock cable', consumable: 'Consumable' }
const inputClass = 'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs text-text focus:border-brand focus:outline-none'

const blankGroup = () => ({ role: 'access', type: 'RJ45', speed: '', poe: false, count: '24', start: '1', pattern: 'Gi1/0/{n}' })

const EMPTY = {
  kind: 'device_model',
  category: 'switch',
  vendor: '',
  model: '',
  description: '',
  heightU: '1',
  rackMounted: true,
  mounting: 'front',
  fullDepth: false,
  weightKg: '',
  powerDrawW: '',
  powerInletType: '',
  poeBudgetW: '',
  psuCount: '',
  needsUplinkModule: false,
  requiresDualPsu: false,
  groups: [],
  opticMedia: 'om4',
  opticSpeed: '10G',
  opticReachM: '',
  compatibleSfps: '',
  compatiblePsus: '',
  compatibleModules: '',
  price: '',
  currency: 'EUR',
  servonAvailable: false,
  servonProductCode: '',
  eosDate: '',
  eolDate: '',
  artworkFront: '',
  artworkRear: '',
}

const str = (v) => (v == null ? '' : String(v))

function fromItem(item) {
  return {
    ...EMPTY,
    ...Object.fromEntries(
      Object.entries(item)
        .filter(([k, v]) => k in EMPTY && (v === null || typeof v !== 'object'))
        .map(([k, v]) => [k, typeof EMPTY[k] === 'boolean' ? Boolean(v) : str(v)])
    ),
    groups: (item.portMap?.groups ?? []).map((g) => ({ ...g, speed: str(g.speed), count: str(g.count), start: str(g.start) })),
    opticMedia: item.mediaSpeed?.media ?? EMPTY.opticMedia,
    opticSpeed: item.mediaSpeed?.speed ?? EMPTY.opticSpeed,
    opticReachM: str(item.mediaSpeed?.reachM),
    compatibleSfps: item.compatibleSfps.join('; '),
    compatiblePsus: item.compatiblePsus.join('; '),
    compatibleModules: item.compatibleModules.join('; '),
    price: item.unitPriceMinor == null ? '' : (item.unitPriceMinor / 100).toFixed(2),
    currency: item.currency ?? 'EUR',
    mounting: item.mounting ?? '',
  }
}

const num = (v) => (String(v).trim() === '' ? null : Number(v))
const list = (v) =>
  String(v)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

function toPayload(form) {
  return {
    kind: form.kind,
    category: form.category,
    vendor: form.vendor,
    model: form.model,
    description: form.description || null,
    heightU: num(form.heightU),
    rackMounted: form.rackMounted,
    mounting: form.rackMounted ? form.mounting || null : null,
    fullDepth: form.fullDepth,
    weightKg: num(form.weightKg),
    powerDrawW: num(form.powerDrawW),
    powerInletType: form.powerInletType || null,
    poeBudgetW: num(form.poeBudgetW),
    psuCount: num(form.psuCount),
    needsUplinkModule: form.needsUplinkModule,
    requiresDualPsu: form.requiresDualPsu,
    portMap: form.groups.length
      ? { groups: form.groups.map((g) => ({ role: g.role, type: g.type, speed: g.speed || null, poe: g.poe, count: num(g.count), start: num(g.start) ?? 1, pattern: g.pattern })) }
      : null,
    mediaSpeed: form.kind === 'optic' ? { media: form.opticMedia, speed: form.opticSpeed, reachM: num(form.opticReachM) } : null,
    compatibleSfps: list(form.compatibleSfps),
    compatiblePsus: list(form.compatiblePsus),
    compatibleModules: list(form.compatibleModules),
    unitPriceMinor: parseToMinor(form.price),
    currency: form.currency.toUpperCase(),
    servonAvailable: form.servonAvailable,
    servonProductCode: form.servonProductCode || null,
    eosDate: form.eosDate || null,
    eolDate: form.eolDate || null,
    artworkFront: form.artworkFront || null,
    artworkRear: form.artworkRear || null,
  }
}

function Field({ label, error, children, wide = false }) {
  return (
    <label className={`block space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs text-text-secondary">{label}</span>
      {children}
      {error && <span className="block text-[11px] text-status-red">{error}</span>}
    </label>
  )
}

function Check({ label, checked, onChange }) {
  return (
    <label className="flex h-9 items-center gap-2 text-xs text-text">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

// Org Admin add/edit of an organisation catalogue item. Validated live with
// the same shared schema the server applies (shared/src/catalogue.js).
export default function CatalogueItemForm() {
  const { orgId, itemId } = useParams()
  const [searchParams] = useSearchParams()
  const fromId = searchParams.get('from')
  const navigate = useNavigate()
  const { memberships } = useAuth()
  const canManage = canIn(memberships, orgId, null, ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)
  const [form, setForm] = useState(itemId || fromId ? null : EMPTY)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState(null)

  useEffect(() => {
    const sourceId = itemId ?? fromId
    if (!sourceId) return
    catalogueApi
      .get(orgId, sourceId)
      .then((r) => setForm(fromItem(r.item)))
      .catch((err) => setServerError(err.message))
  }, [orgId, itemId, fromId])

  const payload = useMemo(() => (form ? toPayload(form) : null), [form])
  const parsed = useMemo(() => (payload ? catalogueItemSchema.safeParse(payload) : null), [payload])
  const errors = useMemo(() => {
    const map = {}
    if (form && Number.isNaN(parseToMinor(form.price))) map.unitPriceMinor = 'Use a number, e.g. 1450.00'
    for (const issue of parsed?.success ? [] : parsed?.error.issues ?? []) {
      const key = issue.path[0] === 'portMap' && issue.path[2] != null ? `group${issue.path[2]}` : String(issue.path[0] ?? 'form')
      map[key] ??= issue.message
    }
    return map
  }, [parsed, form])
  const portPreview = useMemo(() => (parsed?.success && parsed.data.portMap ? expandPortMap(parsed.data.portMap) : []), [parsed])

  if (!canManage) return <div className="p-6 text-sm text-text-secondary">Only an Org Admin can add or edit catalogue items.</div>
  if (!form) return <div className="p-6 text-sm text-text-secondary">{serverError ?? 'Loading…'}</div>

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setGroup = (i, patch) => set({ groups: form.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) })
  const err = (key) => (touched ? errors[key] : null)
  const valid = Object.keys(errors).length === 0

  async function save() {
    setTouched(true)
    if (!valid) return
    setSaving(true)
    setServerError(null)
    try {
      const res = itemId ? await catalogueApi.replace(orgId, itemId, parsed.data) : await catalogueApi.create(orgId, parsed.data)
      navigate(`/orgs/${orgId}/catalogue/${res.item.id}`)
    } catch (e) {
      setServerError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-4 p-4 sm:p-6">
      <Link to={itemId ? `/orgs/${orgId}/catalogue/${itemId}` : `/orgs/${orgId}/catalogue`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        Back
      </Link>
      <h1 className="text-2xl font-bold text-text">{itemId ? 'Edit catalogue item' : fromId ? 'Override a seeded item' : 'Add catalogue item'}</h1>
      {fromId && <p className="text-sm text-text-secondary">Saving creates an organisation item with the same vendor and model, which then takes precedence over the seeded one.</p>}

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
        <Field label="Kind">
          <select value={form.kind} onChange={(e) => set({ kind: e.target.value })} className={inputClass}>
            {CATALOGUE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category" error={err('category')}>
          <select value={form.category} onChange={(e) => set({ category: e.target.value })} className={inputClass}>
            {CATEGORY_GROUPS.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.categories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Vendor" error={err('vendor')}>
          <input value={form.vendor} onChange={(e) => set({ vendor: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Model" error={err('model')}>
          <input value={form.model} onChange={(e) => set({ model: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Description" wide>
          <input value={form.description} onChange={(e) => set({ description: e.target.value })} className={inputClass} />
        </Field>
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4">
        <Field label="RU height" error={err('heightU')}>
          <input type="number" min="0" value={form.heightU} onChange={(e) => set({ heightU: e.target.value })} className={inputClass} />
        </Field>
        <Check label="Rack-mounted" checked={form.rackMounted} onChange={(v) => set({ rackMounted: v, mounting: v ? form.mounting || 'front' : '' })} />
        <Field label="Mounting" error={err('mounting')}>
          <select value={form.mounting} disabled={!form.rackMounted} onChange={(e) => set({ mounting: e.target.value })} className={inputClass}>
            <option value="">—</option>
            {MOUNTINGS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Check label="Full depth" checked={form.fullDepth} onChange={(v) => set({ fullDepth: v })} />
        <Field label="Weight (kg)" error={err('weightKg')}>
          <input type="number" min="0" step="0.1" value={form.weightKg} onChange={(e) => set({ weightKg: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Power draw (W)" error={err('powerDrawW')}>
          <input type="number" min="0" value={form.powerDrawW} onChange={(e) => set({ powerDrawW: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Power inlet (e.g. C14)">
          <input value={form.powerInletType} onChange={(e) => set({ powerInletType: e.target.value })} className={inputClass} />
        </Field>
        <Field label="PoE budget (W)" error={err('poeBudgetW')}>
          <input type="number" min="0" value={form.poeBudgetW} onChange={(e) => set({ poeBudgetW: e.target.value })} className={inputClass} />
        </Field>
        <Field label="PSU slots" error={err('psuCount')}>
          <input type="number" min="0" value={form.psuCount} onChange={(e) => set({ psuCount: e.target.value })} className={inputClass} />
        </Field>
        <Check label="Needs uplink module" checked={form.needsUplinkModule} onChange={(v) => set({ needsUplinkModule: v })} />
        <Check label="Requires dual PSU" checked={form.requiresDualPsu} onChange={(v) => set({ requiresDualPsu: v })} />
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Port map</h2>
          <button type="button" onClick={() => set({ groups: [...form.groups, blankGroup()] })} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-text hover:border-brand">
            <Plus size={13} strokeWidth={2} />
            Add port group
          </button>
        </div>
        <p className="text-[11px] text-text-secondary">Port IDs are generated from the pattern: {'{n}'} is the number, {'{n:2}'} zero-pads it. Numbering is exact — no skipped or duplicated ports.</p>
        {form.groups.map((g, i) => (
          <div key={i} className="space-y-1">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
              <select aria-label="Port role" value={g.role} onChange={(e) => setGroup(i, { role: e.target.value })} className={inputClass}>
                {PORT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input aria-label="Port type" placeholder="Type" value={g.type} onChange={(e) => setGroup(i, { type: e.target.value })} className={inputClass} />
              <input aria-label="Port speed" placeholder="Speed" value={g.speed} onChange={(e) => setGroup(i, { speed: e.target.value })} className={inputClass} />
              <input aria-label="Port count" type="number" min="1" placeholder="Count" value={g.count} onChange={(e) => setGroup(i, { count: e.target.value })} className={inputClass} />
              <input aria-label="First number" type="number" min="0" placeholder="Start" value={g.start} onChange={(e) => setGroup(i, { start: e.target.value })} className={inputClass} />
              <input aria-label="Port pattern" placeholder="Pattern" value={g.pattern} onChange={(e) => setGroup(i, { pattern: e.target.value })} className={inputClass} />
              <Check label="PoE" checked={g.poe} onChange={(v) => setGroup(i, { poe: v })} />
              <button type="button" aria-label="Remove port group" onClick={() => set({ groups: form.groups.filter((_, j) => j !== i) })} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
            {err(`group${i}`) && <p className="text-[11px] text-status-red">{err(`group${i}`)}</p>}
          </div>
        ))}
        {err('portMap') && <p className="text-[11px] text-status-red">{err('portMap')}</p>}
        {portPreview.length > 0 && (
          <p className="text-xs text-text-secondary" data-testid="port-preview">
            {portPreview.length} ports: {portPreview[0].id} … {portPreview.at(-1).id}
          </p>
        )}
      </section>

      {form.kind === 'optic' && (
        <section className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3">
          <Field label="Media">
            <select value={form.opticMedia} onChange={(e) => set({ opticMedia: e.target.value })} className={inputClass}>
              {OPTIC_MEDIA.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Speed">
            <input value={form.opticSpeed} onChange={(e) => set({ opticSpeed: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Reach (m)" error={err('mediaSpeed')}>
            <input type="number" min="1" value={form.opticReachM} onChange={(e) => set({ opticReachM: e.target.value })} className={inputClass} />
          </Field>
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3">
        <Field label="Compatible SFPs (separate with ;)">
          <input value={form.compatibleSfps} onChange={(e) => set({ compatibleSfps: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Compatible PSUs">
          <input value={form.compatiblePsus} onChange={(e) => set({ compatiblePsus: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Compatible modules">
          <input value={form.compatibleModules} onChange={(e) => set({ compatibleModules: e.target.value })} className={inputClass} />
        </Field>
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4">
        <Field label="Unit price" error={err('unitPriceMinor')}>
          <input inputMode="decimal" placeholder="Not priced" value={form.price} onChange={(e) => set({ price: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Currency" error={err('currency')}>
          <input value={form.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value })} className={inputClass} />
        </Field>
        <Check label="SERVON available" checked={form.servonAvailable} onChange={(v) => set({ servonAvailable: v })} />
        <Field label="SERVON code" error={err('servonProductCode')}>
          <input value={form.servonProductCode} onChange={(e) => set({ servonProductCode: e.target.value })} className={inputClass} />
        </Field>
        <Field label="End of sale" error={err('eosDate')}>
          <input type="date" value={form.eosDate} onChange={(e) => set({ eosDate: e.target.value })} className={inputClass} />
        </Field>
        <Field label="End of life" error={err('eolDate')}>
          <input type="date" value={form.eolDate} onChange={(e) => set({ eolDate: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Front artwork (https URL or asset path)" error={err('artworkFront')}>
          <input value={form.artworkFront} onChange={(e) => set({ artworkFront: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Rear artwork" error={err('artworkRear')}>
          <input value={form.artworkRear} onChange={(e) => set({ artworkRear: e.target.value })} className={inputClass} />
        </Field>
      </section>

      {serverError && <p className="text-sm text-status-red">{serverError}</p>}
      {touched && !valid && <p className="text-sm text-status-red">Fix the highlighted fields.</p>}
      <button type="button" disabled={saving} onClick={save} className="h-9 rounded-lg bg-brand px-5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50">
        {saving ? 'Saving…' : itemId ? 'Save changes' : 'Add item'}
      </button>
    </div>
  )
}
