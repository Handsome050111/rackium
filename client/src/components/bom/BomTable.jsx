import { CheckCircle2, Clock, Ban } from 'lucide-react'
import { PROCUREMENT_STATUSES } from '../../api/bomDesign.js'

const CATEGORY_ORDER = ['Network devices', 'Optics & fibre', 'Cables', 'Power & accessories']

const STATUS_ICON = { Suggested: CheckCircle2, Calculated: CheckCircle2, 'Compatibility check': Clock, 'Not required': Ban }
const STATUS_COLOR = { Suggested: 'text-status-green', Calculated: 'text-status-green', 'Compatibility check': 'text-status-amber', 'Not required': 'text-text-secondary' }

function money(n, currency) {
  if (n == null) return '—'
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function BomTable({ lines, currency, canSeePricing, canEditVendor, procurementLocked, onSetVendor, onSetProcurement }) {
  const byCategory = CATEGORY_ORDER.map((cat) => ({ cat, lines: lines.filter((l) => l.category === cat) })).filter((g) => g.lines.length > 0)

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-text-secondary">
            {['#', 'Item / Specification', 'Basis', 'Qty', 'Unit', 'Status', 'Vendor', ...(canSeePricing ? ['Unit price', 'Line total'] : []), 'Procurement'].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {byCategory.map((group) => (
            <GroupRows
              key={group.cat}
              group={group}
              currency={currency}
              canSeePricing={canSeePricing}
              canEditVendor={canEditVendor}
              procurementLocked={procurementLocked}
              onSetVendor={onSetVendor}
              onSetProcurement={onSetProcurement}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({ group, currency, canSeePricing, canEditVendor, procurementLocked, onSetVendor, onSetProcurement }) {
  return (
    <>
      <tr className="border-b border-border bg-brand/5">
        <td colSpan={canSeePricing ? 10 : 8} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
          {group.cat}
        </td>
      </tr>
      {group.lines.map((line, i) => {
        const Icon = STATUS_ICON[line.status] ?? CheckCircle2
        return (
          <tr key={line.key} className="border-b border-border/60 last:border-0">
            <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{i + 1}</td>
            <td className="px-3 py-1.5">
              <div className="font-medium text-text">{line.item}</div>
              <div className="text-[11px] text-text-secondary">{line.spec}</div>
            </td>
            <td className="px-3 py-1.5 text-text-secondary">{line.basis}</td>
            <td className="whitespace-nowrap px-3 py-1.5 font-medium text-text">{line.qty}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{line.unit}</td>
            <td className="whitespace-nowrap px-3 py-1.5">
              <span className={`flex items-center gap-1 ${STATUS_COLOR[line.status] ?? 'text-text'}`}>
                <Icon size={13} strokeWidth={2} />
                {line.status}
              </span>
            </td>
            <td className="whitespace-nowrap px-3 py-1.5">
              <VendorCell line={line} editable={canEditVendor} onSet={onSetVendor} />
            </td>
            {canSeePricing && (
              <>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{money(line.unitPrice, currency)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium text-text">{money(line.lineTotal, currency)}</td>
              </>
            )}
            <td className="whitespace-nowrap px-3 py-1.5">
              <ProcurementCell line={line} locked={procurementLocked} onSet={onSetProcurement} />
            </td>
          </tr>
        )
      })}
    </>
  )
}

function VendorCell({ line, editable, onSet }) {
  if (!editable) return <span className="text-text-secondary">{line.vendor ?? '—'}</span>
  return (
    <input
      defaultValue={line.vendor ?? ''}
      onBlur={(e) => e.target.value !== (line.vendor ?? '') && onSet(line.key, e.target.value)}
      placeholder="Vendor"
      className="h-7 w-28 rounded border border-border px-1.5 text-xs focus:border-brand focus:outline-none"
    />
  )
}

function ProcurementCell({ line, locked, onSet }) {
  if (locked) {
    return (
      <span title="Unlocks after the Solution Package is approved" className="text-text-secondary">
        {line.procurementStatus} <Ban size={11} strokeWidth={2} className="ml-1 inline" />
      </span>
    )
  }
  return (
    <select
      value={line.procurementStatus}
      onChange={(e) => onSet(line.key, { procurementStatus: e.target.value })}
      className="h-7 rounded border border-border bg-surface px-1.5 text-xs focus:border-brand focus:outline-none"
    >
      {PROCUREMENT_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}
