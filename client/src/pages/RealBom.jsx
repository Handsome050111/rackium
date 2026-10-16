import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Server, Link2, Boxes, AlertTriangle, CheckCircle2, Lock } from 'lucide-react'
import DocumentExports from '../components/documents/DocumentExports.jsx'
import StatusChip from '../components/StatusChip.jsx'
import BomTable from '../components/bom/BomTable.jsx'
import CalculationLogicPanel from '../components/bom/CalculationLogicPanel.jsx'
import { deliveryApi, toTableLine, majorUnits, clientBomSheet, procurementSheet, downloadSheet } from '../api/deliveryApi.js'
import { PROCUREMENT_LABELS } from '@rackium/shared/procurement.js'
import { useProjectRoles } from '../lib/useProjectRoles.js'

const inputClass = 'h-8 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none disabled:bg-surface-muted'

function Kpi({ icon: Icon, value, label, tone = 'text-brand' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Icon size={18} strokeWidth={2} className={`shrink-0 ${tone}`} />
      <div className="min-w-0">
        <div className="text-lg font-bold leading-tight text-text">{value}</div>
        <div className="text-[11px] text-text-secondary">{label}</div>
      </div>
    </div>
  )
}
const money = (minor, currency) => (minor == null ? '—' : `${currency} ${majorUnits(minor).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

// Real-mode BOM (brief v2.3 §5.6; M5a): the Draft BOM calculated from the
// design, then — after the client approves the Solution Package and the PM
// approves the procurement BOM — procurement per line.
export default function RealBom() {
  const { orgId, projectId, buildingId } = useParams()
  const { readOnly, has } = useProjectRoles(orgId, projectId)
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const [clientMode, setClientMode] = useState('sell')

  const reload = useCallback(async () => {
    try {
      setView(await deliveryApi.bom(orgId, projectId, buildingId))
      setError(null)
    } catch (err) {
      setError(err.status === 404 ? 'This building is not in the part of the project you can see.' : err.message)
    }
  }, [orgId, projectId, buildingId])
  useEffect(() => {
    reload()
  }, [reload])

  const isPm = !readOnly && has('pm')
  async function act(fn, done) {
    try {
      await fn()
      if (done) setNotice(done)
      setError(null)
      await reload()
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  if (error && !view) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!view) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  const { procurement } = view
  const lines = view.lines.map(toTableLine)
  const selected = view.lines.find((l) => l.key === selectedKey) ?? null
  const serialised = view.lines.filter((l) => l.lineType === 'serialised').length
  const optics = view.lines.filter((l) => l.key.startsWith('optic:')).reduce((n, l) => n + l.qty, 0)
  const cables = view.lines.filter((l) => l.category === 'Cables').reduce((n, l) => n + l.qty, 0)
  const canProcure = isPm && procurement.unlocked
  const canApprove = isPm && procurement.spApproved && (!procurement.bomApproved || procurement.changesSinceApproval.length > 0)

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
      <Link to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        {view.building.code} dashboard
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text">Suggested BOM — {view.building.name}</h1>
          <p className="text-sm text-text-secondary">Calculated from the {view.stage === 'lld' ? 'LLD' : 'HLD'} (survey, HLD and LLD records) — every line carries its source and reason</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={view.status} subLabel={view.subLabel} />
          <button type="button" onClick={() => downloadSheet(procurementSheet(view.lines, { showPrices: view.showPrices }), 'BOM', `${view.building.code}-bom-procurement.xlsx`)} className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand sm:h-9">
            <Download size={14} strokeWidth={2} />
            Export BOM
          </button>
          <DocumentExports
            orgId={orgId}
            projectId={projectId}
            buildingId={buildingId}
            items={[
              { typeKey: 'bom-final', format: 'xlsx', label: 'BOM, quantities only' },
              { typeKey: 'bom-final', format: 'pdf', label: 'BOM, quantities only' },
              ...(view.showPrices
                ? [
                    { typeKey: 'bom-final', format: 'xlsx', label: 'BOM with client prices', options: { prices: 'sell' } },
                    { typeKey: 'bom-final', format: 'pdf', label: 'BOM with client prices', options: { prices: 'sell' } },
                  ]
                : []),
              // Internal only (never shared with the client): Org Admin, PM, Reviewer.
              ...(!readOnly && ['org_admin', 'pm', 'reviewer'].some(has)
                ? [
                    { typeKey: 'bom-final', format: 'xlsx', label: 'INTERNAL — BOM with cost prices', options: { prices: 'cost' } },
                    { typeKey: 'bom-final', format: 'pdf', label: 'INTERNAL — BOM with cost prices', options: { prices: 'cost' } },
                  ]
                : []),
            ]}
          />
          {canApprove && (
            <button type="button" onClick={() => act(() => deliveryApi.approveBom(orgId, projectId, { buildingId }), 'Procurement BOM approved')} className="h-touch rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 sm:h-9">
              {procurement.bomApproved ? 'Re-approve procurement BOM' : 'Approve procurement BOM'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-status-red">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-status-green">
          {notice}
        </p>
      )}
      {!procurement.unlocked && (
        <p className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-muted px-3 py-2 text-xs text-text-secondary" data-testid="procurement-locked">
          <Lock size={13} strokeWidth={2} />
          {procurement.spApproved ? 'The Solution Package is approved — the PM approves the procurement BOM to unlock procurement.' : 'Draft BOM — procurement unlocks after the client approves the Solution Package and the PM approves the procurement BOM.'}
        </p>
      )}
      {procurement.bomApproved && procurement.changesSinceApproval.length > 0 && (
        <div className="rounded-xl border border-status-amber/40 bg-status-amber/5 p-3 text-xs" data-testid="bom-changed">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-status-amber">
            <AlertTriangle size={13} strokeWidth={2} />
            Changed since the approved procurement BOM v{procurement.approvedVersionNumber} — the PM re-approves it
          </div>
          <ul className="space-y-0.5 text-text-secondary">
            {procurement.changesSinceApproval.map((l) => (
              <li key={l.key}>
                {l.item} ({l.spec}): {l.before} → {l.after}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={Server} value={serialised} label="serialised devices" />
        <Kpi icon={Link2} value={optics} label="optics (link ends)" />
        <Kpi icon={Link2} value={cables} label="cables" />
        <Kpi icon={Boxes} value={view.lines.length} label="BOM lines" />
        <Kpi icon={AlertTriangle} value={view.unpricedCount} label="not priced" tone={view.unpricedCount ? 'text-status-amber' : 'text-status-green'} />
        <Kpi icon={CheckCircle2} value={view.reconciliation.reconciled ? 'Yes' : 'No'} label="reconciles with design" tone={view.reconciliation.reconciled ? 'text-status-green' : 'text-status-amber'} />
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-3">
          <BomTable
            lines={lines}
            currency={view.currency}
            canSeePricing={view.showPrices}
            canEditVendor={false}
            procurementLocked={!procurement.unlocked}
            showSource
            renderProcurement={(line) => (
              <span className="flex items-center gap-2">
                <span className={line.procurement.status === 'delivered' ? 'text-status-green' : 'text-text-secondary'}>{PROCUREMENT_LABELS[line.procurement.status]}</span>
                {canProcure && (
                  <button type="button" onClick={() => setSelectedKey(line.key)} aria-label={`Update procurement of ${line.item} ${line.spec}`} className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-brand hover:border-brand">
                    Update
                  </button>
                )}
              </span>
            )}
          />
          {view.orphans.length > 0 && <p className="text-xs text-status-amber">{view.orphans.length} procured line(s) are no longer in the BOM after a change — review them with the vendor.</p>}
        </div>

        <div className="w-full shrink-0 space-y-4 xl:w-80">
          {selected && canProcure && <ProcurementEditor key={`${selected.key}-${selected.procurement.version}`} line={selected} onCancel={() => setSelectedKey(null)} onSave={(patch) => act(() => deliveryApi.updateLine(orgId, projectId, { buildingId, lineKey: selected.key, version: selected.procurement.version, ...patch }), 'Procurement line saved')} />}
          {view.pricing && (
            <PricingPanel
              view={view}
              isPm={isPm}
              clientMode={clientMode}
              setClientMode={setClientMode}
              onMargin={(marginPercent) => act(() => deliveryApi.setCommercial(orgId, projectId, { marginPercent }), 'Margin saved')}
              onClientExport={() => downloadSheet(clientBomSheet(view.lines, { mode: clientMode, marginPercent: view.pricing.marginPercent, currency: view.currency }), 'BOM', `${view.building.code}-bom-client.xlsx`)}
            />
          )}
          {isPm && <CordStandardPanel orgId={orgId} projectId={projectId} onSaved={(msg) => act(async () => {}, msg)} onError={setError} />}
          <CalculationLogicPanel calc={view.calc} reconciliation={view.reconciliation} />
          <ul className="space-y-1 rounded-xl border border-border bg-surface p-3 text-xs" aria-label="Reconciliation">
            {view.reconciliation.checks.map((c) => (
              <li key={c.key} className={`flex justify-between ${c.ok ? 'text-text-secondary' : 'text-status-amber'}`}>
                <span>{c.label}</span>
                <span>
                  BOM {c.bom} / design {c.design}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function PricingPanel({ view, isPm, clientMode, setClientMode, onMargin, onClientExport }) {
  const [margin, setMargin] = useState(String(view.pricing.marginPercent))
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-4 text-xs" data-testid="pricing">
      <div className="text-sm font-semibold text-text">Pricing summary</div>
      <div className="flex justify-between">
        <span className="text-text-secondary">Cost total (priced lines)</span>
        <span className="font-medium text-text">{money(view.pricing.costMinor, view.currency)}</span>
      </div>
      <label className="flex items-center justify-between gap-2">
        <span className="text-text-secondary">Margin %</span>
        <input aria-label="Margin %" type="number" min="0" max="500" value={margin} disabled={!isPm} onChange={(e) => setMargin(e.target.value)} onBlur={() => Number(margin) !== view.pricing.marginPercent && onMargin(Number(margin))} className="h-7 w-20 rounded border border-border px-1.5 text-right focus:border-brand focus:outline-none" />
      </label>
      <div className="flex justify-between border-t border-border pt-2">
        <span className="font-medium text-text-secondary">Total incl. margin</span>
        <span className="font-semibold text-text">{money(view.pricing.sellMinor, view.currency)}</span>
      </div>
      {view.unpricedCount > 0 && <p className="text-status-amber">{view.unpricedCount} line(s) not priced are not in these totals.</p>}
      {isPm && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <select aria-label="Client export" value={clientMode} onChange={(e) => setClientMode(e.target.value)} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs">
            <option value="sell">Client export: prices (margin not shown)</option>
            <option value="none">Client export: no prices</option>
          </select>
          <button type="button" onClick={onClientExport} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 font-medium text-text hover:border-brand">
            <Download size={12} strokeWidth={2} />
            Client export
          </button>
        </div>
      )}
    </div>
  )
}

function ProcurementEditor({ line, onSave, onCancel }) {
  const p = line.procurement
  const [form, setForm] = useState({ status: p.status, vendor: p.vendor ?? '', poNumber: p.poNumber ?? '', expectedDelivery: p.expectedDelivery ?? '', actualDelivery: p.actualDelivery ?? '', notes: p.notes ?? '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  function save() {
    const patch = {}
    if (form.status !== p.status) patch.status = form.status
    for (const k of ['vendor', 'poNumber', 'notes']) if ((form[k] || null) !== (p[k] ?? null)) patch[k] = form[k] || null
    for (const k of ['expectedDelivery', 'actualDelivery']) if ((form[k] || null) !== (p[k] ?? null)) patch[k] = form[k] || null
    if (Object.keys(patch).length) onSave(patch)
  }
  return (
    <div className="space-y-2 rounded-xl border border-brand/40 bg-surface p-4 text-xs" data-testid="procurement-editor">
      <div className="text-sm font-semibold text-text">
        {line.item} <span className="font-normal text-text-secondary">· {line.spec}</span>
      </div>
      <label className="block space-y-1">
        <span className="text-text-secondary">Status</span>
        <select aria-label="Procurement status" value={form.status} onChange={set('status')} className={inputClass}>
          {[p.status, ...p.next].map((s) => (
            <option key={s} value={s}>
              {PROCUREMENT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {[
        ['vendor', 'Vendor', 'text'],
        ['poNumber', 'PO number', 'text'],
        ['expectedDelivery', 'Expected delivery', 'date'],
        ['actualDelivery', 'Actual delivery', 'date'],
        ['notes', 'Notes', 'text'],
      ].map(([k, label, type]) => (
        <label key={k} className="block space-y-1">
          <span className="text-text-secondary">{label}</span>
          <input aria-label={label} type={type} value={form[k]} onChange={set(k)} className={inputClass} />
        </label>
      ))}
      {p.updatedBy && (
        <p className="text-[11px] text-text-secondary">
          Last updated by {p.updatedBy} · {new Date(p.updatedAt).toLocaleString()}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={save} className="h-8 rounded-lg bg-brand px-3 font-medium text-white hover:bg-brand/90">
          Save
        </button>
        <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-border px-3 font-medium text-text">
          Close
        </button>
      </div>
    </div>
  )
}

function CordStandardPanel({ orgId, projectId, onSaved, onError }) {
  const [settings, setSettings] = useState(null)
  const [label, setLabel] = useState('')
  const [pair, setPair] = useState('')
  useEffect(() => {
    deliveryApi.commercial(orgId, projectId).then((res) => {
      setSettings(res.settings)
      setLabel(res.settings.powerCordStandard?.label ?? '')
      setPair(res.settings.powerCordStandard?.connectorPair ?? '')
    })
  }, [orgId, projectId])
  if (!settings) return null
  async function save(standard) {
    try {
      const res = await deliveryApi.setCommercial(orgId, projectId, { powerCordStandard: standard })
      setSettings(res.settings)
      onSaved(standard ? 'Customer power-cord standard saved' : 'Customer power-cord standard cleared')
    } catch (err) {
      onError(err.message)
    }
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-4 text-xs" data-testid="cord-standard">
      <div className="text-sm font-semibold text-text">Customer power-cord standard</div>
      <p className="text-text-secondary">Overrides every cord. Without it: the rack PDU socket, else the country plug table.</p>
      <input aria-label="Cord label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 2 m C13/C14, black" className={inputClass} />
      <input aria-label="Connector pair" value={pair} onChange={(e) => setPair(e.target.value)} placeholder="e.g. C13/C14" className={inputClass} />
      <div className="flex gap-2">
        <button type="button" disabled={!label.trim() || pair.trim().length < 3} onClick={() => save({ label: label.trim(), connectorPair: pair.trim() })} className="h-8 rounded-lg border border-brand px-3 font-medium text-brand hover:bg-brand/5 disabled:border-border disabled:text-text-secondary">
          Save standard
        </button>
        {settings.powerCordStandard && (
          <button type="button" onClick={() => save(null)} className="h-8 rounded-lg border border-border px-3 font-medium text-text">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
