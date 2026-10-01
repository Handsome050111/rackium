import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Server, Link2, Boxes, CheckCircle2 } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import StatusChip from '../components/StatusChip.jsx'
import BomTable from '../components/bom/BomTable.jsx'
import CalculationLogicPanel from '../components/bom/CalculationLogicPanel.jsx'
import { getBuilding } from '../api/index.js'
import { getBomContext, setLineVendor, setLineProcurement, approveProcurementBom } from '../api/bomDesign.js'
import { setMarginPercent } from '../api/projectSettings.js'
import { exportBomXlsx } from '../lib/bomExport.js'
import { useRole } from '../lib/RoleContext.jsx'
import { canViewBomPricing, canEditBomVendor, canApproveBom } from '../lib/permissions.js'

function Kpi({ icon: Icon, value, label }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Icon size={18} strokeWidth={2} className="shrink-0 text-brand" />
      <div>
        <div className="text-lg font-bold leading-tight text-text">{value}</div>
        <div className="text-[11px] text-text-secondary">{label}</div>
      </div>
    </div>
  )
}

export default function Bom() {
  const { buildingId } = useParams()
  const { role } = useRole()
  const [building, setBuilding] = useState(null)
  const [context, setContext] = useState(null)
  const [marginInput, setMarginInput] = useState('')

  const reload = useCallback(() => {
    if (!buildingId) return
    getBomContext(buildingId).then((ctx) => {
      setContext(ctx)
      setMarginInput(String(ctx.marginPercent))
    })
  }, [buildingId])

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
  }, [buildingId])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleSetVendor(key, vendor) {
    await setLineVendor(buildingId, key, vendor)
    reload()
  }

  async function handleSetProcurement(key, patch) {
    await setLineProcurement(buildingId, key, patch)
    reload()
  }

  async function handleMarginSave() {
    const pct = Number(marginInput)
    if (Number.isFinite(pct)) {
      await setMarginPercent(pct)
      reload()
    }
  }

  async function handleApproveBom() {
    const result = await approveProcurementBom(buildingId)
    if (result.ok) reload()
  }

  if (!building || !context) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const canSeePricing = canViewBomPricing(role)
  const canEditVendor = canEditBomVendor(role)
  const canApprove = canApproveBom(role)

  const opticsLines = context.lines.filter((l) => l.category === 'Optics & fibre')
  const os2Links = opticsLines.filter((l) => l.item.includes('LR') || l.item.includes('ER') || l.item.includes('1G-LX')).reduce((s, l) => s + l.qty, 0) / 2
  const om4Links = opticsLines.filter((l) => l.item.includes('SR')).reduce((s, l) => s + l.qty, 0) / 2
  const linkCount = context.lines.filter((l) => l.category === 'Cables').reduce((s, l) => s + l.qty, 0)
  const deviceCount = context.lines.filter((l) => l.category === 'Network devices' && l.key !== 'device:probe').reduce((s, l) => s + l.qty, 0)

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
      <Breadcrumb items={[...building.breadcrumb, { label: 'BOM' }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Suggested BOM — {building.name}</h1>
          <p className="text-sm text-text-secondary">Auto-generated from validated survey, finalised HLD and adjusted LLD</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={context.status} subLabel={context.subLabel} />
          <button
            type="button"
            onClick={() => exportBomXlsx(context.lines, `${building.code}-bom.xlsx`)}
            className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand sm:h-9"
          >
            <Download size={14} strokeWidth={2} />
            Export
          </button>
          {canApprove && (
            <button
              type="button"
              onClick={handleApproveBom}
              disabled={context.procurementLocked || context.status === 'approved'}
              className="h-touch rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
              title={context.procurementLocked ? 'Unlocks after the Solution Package is approved' : undefined}
            >
              Approve procurement BOM
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={Server} value={deviceCount} label="managed devices" />
        <Kpi icon={Link2} value={linkCount} label="network links" />
        <Kpi icon={Link2} value={os2Links} label="OS2 SM links" />
        <Kpi icon={Link2} value={om4Links} label="OM4 MM links" />
        <Kpi icon={Boxes} value={context.lines.length} label="suggested BOM lines" />
        <Kpi icon={CheckCircle2} value={context.conflicts} label="unresolved design conflicts" />
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="text-sm font-semibold text-text">BOM Items</div>
          <BomTable
            lines={context.lines}
            currency={context.currency}
            canSeePricing={canSeePricing}
            canEditVendor={canEditVendor}
            procurementLocked={context.procurementLocked}
            onSetVendor={handleSetVendor}
            onSetProcurement={handleSetProcurement}
          />
        </div>

        <div className="w-full shrink-0 space-y-4 xl:w-80">
          {canSeePricing && (
            <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
              <div className="text-sm font-semibold text-text">Pricing summary</div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">Cost total</span>
                <span className="font-medium text-text">
                  {context.currency} {context.costTotal.toLocaleString()}
                </span>
              </div>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary">Margin %</span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    value={marginInput}
                    onChange={(e) => setMarginInput(e.target.value)}
                    onBlur={handleMarginSave}
                    className="h-7 w-16 rounded border border-border px-1.5 text-right text-xs focus:border-brand focus:outline-none"
                  />
                  <span className="text-text-secondary">%</span>
                </span>
              </label>
              <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
                <span className="font-medium text-text-secondary">Total incl. margin</span>
                <span className="font-semibold text-text">
                  {context.currency} {context.priceWithMargin.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          <CalculationLogicPanel calc={context.calc} reconciliation={context.reconciliation} />
        </div>
      </div>
    </div>
  )
}
