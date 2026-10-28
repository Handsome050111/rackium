import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GitPullRequest, Plus, PenLine, AlertTriangle } from 'lucide-react'
import ShareLinkPanel from '../ShareLinkPanel.jsx'
import DesignDiff from '../../lld/real/DesignDiff.jsx'
import { deliveryApi } from '../../../api/deliveryApi.js'

const inputClass = 'w-full min-w-0 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text focus:border-brand focus:outline-none disabled:bg-surface-muted'
const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', awaiting_client: 'With the client', approved: 'Approved', changes_requested: 'Changes requested', rejected: 'Rejected', withdrawn: 'Withdrawn' }
const DIFF_COLUMNS = [
  { kind: 'added', title: 'Added', key: 'added' },
  { kind: 'removed', title: 'Removed', key: 'removed' },
  { kind: 'changed', title: 'Changed', key: 'changed' },
]

// Change requests (brief §5.5; M5a): after the design is approved, any change
// is drafted on its own branch — the HLD and the LLD together (M5a review) —
// submitted by the Architect with its design diff and BOM impact, and sent by
// the PM to the client through the same share-link flow. Approval applies both
// to the frozen design. History stays here.
export default function ChangeRequestsPanel({ orgId, projectId, buildingId, packageApproved, canDraft, canSend, onError, onChanged }) {
  const [list, setList] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [draft, setDraft] = useState(null)
  const [secret, setSecret] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await deliveryApi.changeRequests(orgId, projectId, buildingId)
      setList(res.changeRequests)
      if (selectedId) setDetail((await deliveryApi.changeRequest(orgId, projectId, selectedId)).changeRequest)
    } catch (err) {
      onError(err.message)
    }
  }, [orgId, projectId, buildingId, selectedId, onError])
  useEffect(() => {
    load()
  }, [load])

  async function run(fn) {
    try {
      const res = await fn()
      await load()
      await onChanged()
      return res
    } catch (err) {
      onError(err.message)
      return null
    }
  }

  const editable = canDraft && detail && ['draft', 'changes_requested'].includes(detail.status)
  const lldPath = (branchId) => `/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}/lld?branch=${branchId}`
  const hldPath = (branchId) => `/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}/hld?branch=${branchId}`

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="change-requests">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <GitPullRequest size={16} strokeWidth={2} className="text-brand" />
          Change requests
        </div>
        {canDraft && !draft && (
          <button type="button" onClick={() => setDraft({ title: '', reason: '', description: '' })} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-brand hover:border-brand">
            <Plus size={12} strokeWidth={2} />
            New change request
          </button>
        )}
      </div>
      {!packageApproved && list.length === 0 && <p className="text-xs text-text-secondary">After the client approves the package, the design is frozen and every change goes through a change request.</p>}

      {draft && (
        <form
          className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 text-xs"
          onSubmit={async (e) => {
            e.preventDefault()
            const res = await run(() => deliveryApi.createChangeRequest(orgId, projectId, { buildingId, ...draft }))
            if (res) {
              setDraft(null)
              setSelectedId(res.changeRequest.id)
            }
          }}
        >
          <input aria-label="Change request title" required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" className={inputClass} />
          <input aria-label="Change request reason" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} placeholder="Reason" className={inputClass} />
          <textarea aria-label="Change request description" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description" className={inputClass} />
          <div className="flex gap-2">
            <button type="submit" className="h-8 rounded-lg bg-brand px-3 font-medium text-white">
              Create
            </button>
            <button type="button" onClick={() => setDraft(null)} className="h-8 rounded-lg border border-border px-3 font-medium text-text">
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-1 text-xs">
        {list.map((cr) => (
          <li key={cr.id}>
            <button type="button" onClick={() => setSelectedId(cr.id)} className={`flex w-full flex-wrap justify-between gap-2 rounded-lg border px-2 py-1.5 text-left ${cr.id === selectedId ? 'border-brand bg-brand/5' : 'border-border/60 hover:border-brand'}`}>
              <span className="font-medium text-text">
                CR-{cr.number} {cr.title}
              </span>
              <span className="text-text-secondary">{STATUS_LABEL[cr.status]}</span>
            </button>
          </li>
        ))}
      </ul>

      {detail && detail.id === selectedId && (
        <div className="space-y-3 border-t border-border pt-3 text-xs" data-testid="change-request-detail">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-text">
              CR-{detail.number} · {STATUS_LABEL[detail.status]}
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-3">
                <Link to={hldPath(detail.branchId)} className="flex items-center gap-1 font-medium text-brand hover:underline">
                  <PenLine size={12} strokeWidth={2} />
                  Edit the HLD on its branch
                </Link>
                <Link to={lldPath(detail.branchId)} className="flex items-center gap-1 font-medium text-brand hover:underline">
                  <PenLine size={12} strokeWidth={2} />
                  Edit the LLD on its branch
                </Link>
              </div>
            )}
          </div>
          <CrFields key={`${detail.id}-${detail.status}`} detail={detail} editable={editable} onSave={(patch) => run(() => deliveryApi.updateChangeRequest(orgId, projectId, detail.id, patch))} />
          {detail.consistency && !detail.consistency.consistent && (
            <div role="alert" className="space-y-1 rounded-lg border border-status-amber/40 bg-status-amber/5 p-2 text-status-amber" data-testid="cr-inconsistent">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={13} strokeWidth={2} />
                The HLD and LLD of this change are out of step — reconcile the LLD on the branch before submitting
              </div>
              <ul className="list-inside list-disc text-text-secondary">
                {detail.consistency.problems.map((x) => (
                  <li key={`${x.kind}-${x.state}-${x.id}`}>
                    {x.label}: {x.state === 'inHldOnly' ? 'in the HLD, not mapped in the LLD' : x.state === 'inLldOnly' ? 'in the LLD, no longer in the HLD' : 'differs between HLD and LLD'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {detail.impact && (
            <>
              <div className="font-semibold text-text">Design changes ({detail.impact.design.total})</div>
              {detail.impact.design.hld && (
                <DesignDiff columns={DIFF_COLUMNS} sections={[{ title: 'HLD devices', data: detail.impact.design.hld.devices }, { title: 'HLD uplinks', data: detail.impact.design.hld.connections }, ...(detail.impact.design.hld.decisions ? [{ title: 'Decisions on existing gear', data: detail.impact.design.hld.decisions }] : [])]} empty="No HLD change." />
              )}
              <DesignDiff columns={DIFF_COLUMNS} sections={[{ title: detail.impact.design.hld ? 'LLD devices' : 'Devices', data: detail.impact.design.devices }, { title: detail.impact.design.hld ? 'LLD connections' : 'Connections', data: detail.impact.design.connections }]} empty="No LLD change yet — edit the design on its branch." />
              <div className="font-semibold text-text">BOM impact ({detail.impact.bom.total})</div>
              {detail.impact.bom.lines.length === 0 ? (
                <p className="text-text-secondary">No BOM change.</p>
              ) : (
                <ul className="space-y-0.5" data-testid="bom-impact">
                  {detail.impact.bom.lines.map((l) => (
                    <li key={l.key}>
                      <span className="font-medium text-text">{l.item}</span> ({l.spec}): {l.before} → {l.after}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {editable && (
              <button type="button" onClick={() => run(() => deliveryApi.submitChangeRequest(orgId, projectId, detail.id))} className="h-8 rounded-lg bg-brand px-3 font-medium text-white">
                Submit change request
              </button>
            )}
            {canDraft && ['draft', 'changes_requested', 'submitted'].includes(detail.status) && (
              <button type="button" onClick={() => window.confirm(`Withdraw CR-${detail.number}? Its branch is discarded.`) && run(() => deliveryApi.withdrawChangeRequest(orgId, projectId, detail.id))} className="h-8 rounded-lg border border-status-red/40 px-3 font-medium text-status-red">
                Withdraw
              </button>
            )}
          </div>
          {canSend && (detail.status === 'submitted' || secret?.crId === detail.id) && (
            <ShareLinkPanel
              title="Client approval of this change"
              actionLabel="Send to the client"
              activeLink={secret?.crId === detail.id ? secret : null}
              readyForSubmission
              canSubmit={detail.status === 'submitted'}
              onSubmit={async ({ password, expiryDays }) => {
                const res = await run(() => deliveryApi.sendChangeRequest(orgId, projectId, detail.id, { ...(password ? { password } : {}), expiryDays: Number(expiryDays) }))
                if (res) setSecret({ ...res.shareLink, crId: detail.id })
              }}
            />
          )}
          {detail.approvals.length > 0 && (
            <ul className="space-y-0.5 text-text-secondary">
              {detail.approvals.map((a) => (
                <li key={a.id}>
                  {a.status.replace('_', ' ')}
                  {a.client ? ` — ${a.client.name}${a.client.role ? `, ${a.client.role}` : ''}` : ''}
                  {a.decision?.comments ? `: “${a.decision.comments}”` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function CrFields({ detail, editable, onSave }) {
  const [form, setForm] = useState({ description: detail.description, reason: detail.reason, affected: detail.affectedItems.join('\n') })
  return (
    <div className="grid grid-cols-1 gap-2">
      <label className="space-y-1">
        <span className="text-text-secondary">Description</span>
        <textarea aria-label="Description" rows={2} disabled={!editable} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
      </label>
      <label className="space-y-1">
        <span className="text-text-secondary">Reason</span>
        <input aria-label="Reason" disabled={!editable} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputClass} />
      </label>
      <label className="space-y-1">
        <span className="text-text-secondary">Affected items (one per line; filled from the diff when left empty)</span>
        <textarea aria-label="Affected items" rows={2} disabled={!editable} value={form.affected} onChange={(e) => setForm({ ...form, affected: e.target.value })} className={inputClass} />
      </label>
      {editable && (
        <button type="button" onClick={() => onSave({ description: form.description, reason: form.reason, affectedItems: form.affected.split('\n').map((s) => s.trim()).filter(Boolean) })} className="h-8 justify-self-start rounded-lg border border-border px-3 font-medium text-text hover:border-brand">
          Save details
        </button>
      )}
    </div>
  )
}
