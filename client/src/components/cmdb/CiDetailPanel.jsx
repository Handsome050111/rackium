import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { DGUV_LABEL } from '@rackium/shared/dguv.js'
import { DEPLOYMENT_PLACEHOLDER } from '@rackium/shared/lldModel.js'
import { useRole } from '../../lib/RoleContext.jsx'
import { canEditCmdb } from '../../lib/permissions.js'

const TABS = ['Overview', 'Ports & Connections', 'Rack & Location', 'Lifecycle', 'Evidence & History']
const DGUV_COLOR = { valid: 'text-status-green', expiring_soon: 'text-status-amber', expiring: 'text-status-amber', overdue: 'text-status-red' }

function Row({ label, value, tone = 'text-text' }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className={`font-medium ${tone}`}>{value}</span>
    </div>
  )
}

export default function CiDetailPanel({ detail, onOpenPortConnectivity, onOperationalEdit }) {
  const { role } = useRole()
  const editable = canEditCmdb(role)
  const [tab, setTab] = useState('Overview')
  const { entity, connections, dguv, acceptance, changeLog } = detail
  const [assetId, setAssetId] = useState(entity.installation?.assetId ?? '')

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <div className="text-sm font-semibold text-text">{entity.hostname}</div>
        <div className="text-xs text-text-secondary">
          {entity.role} · {entity.model}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-8 shrink-0 px-2 text-[11px] font-medium ${tab === t ? 'border-b-2 border-brand text-brand' : 'text-text-secondary hover:text-text'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Identity</div>
          <Row label="Serial number" value={entity.installation?.serial ?? '—'} />
          <Row label="MAC address" value={entity.installation?.mac ?? '—'} />
          <Row label="Asset ID" value={entity.installation?.assetId ?? '—'} />
          <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Operational</div>
          <Row label="Lifecycle" value={entity.status} />
          <Row label="Acceptance" value={acceptance} />
          <Row label="DGUV" value={dguv ? DGUV_LABEL[dguv.status] : 'n/a'} tone={dguv ? DGUV_COLOR[dguv.status] : undefined} />
        </div>
      )}

      {tab === 'Ports & Connections' && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpenPortConnectivity}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-brand text-xs font-medium text-brand hover:bg-brand/5"
          >
            Open Port Connectivity
            <ExternalLink size={13} strokeWidth={2} />
          </button>
          <div className="text-[11px] text-text-secondary">{connections.length} connection(s) recorded.</div>
        </div>
      )}

      {tab === 'Rack & Location' && (
        <div className="space-y-2">
          <Row label="Floor" value={entity.floorName ?? '—'} />
          <Row label="Room" value={entity.roomCode ?? '—'} />
          <Row label="Rack / RU" value={entity.rackCode ? `${entity.rackCode} / RU${entity.ru ?? '—'}` : '—'} />
          <Row label="Latitude" value={entity.installation?.latitude ?? DEPLOYMENT_PLACEHOLDER} />
          <Row label="Longitude" value={entity.installation?.longitude ?? DEPLOYMENT_PLACEHOLDER} />
        </div>
      )}

      {tab === 'Lifecycle' && (
        <div className="space-y-2">
          <Row label="Current status" value={entity.status} />
          <Row label="Acceptance" value={acceptance} />
          {dguv && <Row label="DGUV due" value={dguv.dueDate ? new Date(dguv.dueDate).toLocaleDateString() : '—'} tone={DGUV_COLOR[dguv.status]} />}
          {editable && (
            <div className="space-y-1 border-t border-border pt-2">
              <label className="block space-y-1">
                <span className="text-[11px] text-text-secondary">Asset ID (operational change)</span>
                <div className="flex gap-1">
                  <input
                    value={assetId}
                    onChange={(e) => setAssetId(e.target.value)}
                    className="h-8 flex-1 rounded-lg border border-border bg-surface px-2 text-xs focus:border-brand focus:outline-none"
                  />
                  <button type="button" onClick={() => onOperationalEdit(entity.id, 'assetId', assetId)} className="h-8 rounded-lg bg-brand px-2.5 text-[11px] font-medium text-white hover:bg-brand/90">
                    Save
                  </button>
                </div>
              </label>
            </div>
          )}
        </div>
      )}

      {tab === 'Evidence & History' && (
        <div className="space-y-2">
          <Row label="Evidence photos" value={entity.installation?.evidenceCount ?? 0} />
          <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Change log</div>
          {changeLog.length === 0 ? (
            <p className="text-xs text-text-secondary">No operational changes recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {changeLog.map((c) => (
                <li key={c.id} className="text-xs">
                  <span className="font-medium text-text">{c.field}</span>: {c.oldValue ?? '—'} → {c.newValue}
                  <span className="ml-1 rounded border border-border px-1 text-[10px] text-text-secondary">{c.changeType}</span>
                  <div className="text-[10px] text-text-secondary">
                    {c.changedBy} · {new Date(c.at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
