import DesignDiff from './DesignDiff.jsx'

const COLUMNS = [
  { kind: 'removed', title: 'In the HLD, not in the LLD', key: 'inHldOnly' },
  { kind: 'added', title: 'In the LLD, no longer in the HLD', key: 'inLldOnly' },
  { kind: 'changed', title: 'Changed (HLD → LLD)', key: 'changed' },
]

// Side-by-side HLD vs LLD reconciliation (brief §5.4): what the newer HLD
// has that the LLD does not, and the reverse — devices and uplinks. Nothing
// re-syncs by itself; each HLD-only item can be copied in explicitly.
export default function LldReconciliation({ reconciliation, editable, onCopy }) {
  if (!reconciliation) return <p className="text-xs text-text-secondary">Loading the comparison…</p>
  return (
    <div className="space-y-2" data-testid="lld-reconciliation">
      <p className="text-xs text-text-secondary">
        HLD v{reconciliation.hldNumber} compared with this LLD (based on HLD v{reconciliation.basedOnNumber}).
      </p>
      <DesignDiff
        columns={COLUMNS}
        sections={[
          { title: 'Devices', data: reconciliation.devices },
          { title: 'Uplinks', data: reconciliation.connections },
        ]}
        empty="The LLD matches the HLD."
        actionFor={(sectionIndex, col, item) =>
          editable && col.key === 'inHldOnly' ? (
            <button type="button" onClick={() => onCopy(sectionIndex === 0 ? { hldDeviceIds: [item.id] } : { hldConnectionIds: [item.id] })} className="rounded border border-brand px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/5">
              Copy into LLD
            </button>
          ) : null
        }
      />
    </div>
  )
}
