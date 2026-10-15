const TONE = {
  design: 'border-brand/30 bg-brand/5 text-brand',
  deployment: 'border-status-green/30 bg-status-green/5 text-status-green',
  manual: 'border-status-amber/40 bg-status-amber/10 text-status-amber',
  import: 'border-purple-300 bg-purple-50 text-purple-700',
}

// Where a CMDB value came from (client audit 9.2): design, deployment,
// manual edit or import — with who set it and when on hover / focus.
export default function ProvenanceBadge({ provenance }) {
  if (!provenance) return null
  const who = [provenance.setBy, provenance.setAt ? new Date(provenance.setAt).toLocaleString() : null].filter(Boolean).join(' · ')
  const label = provenance.label ?? provenance.source
  return (
    <span tabIndex={0} title={who ? `${label}: ${who}` : label} aria-label={`Source: ${label}${who ? `, ${who}` : ''}`} className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE[provenance.source] ?? TONE.design}`}>
      {label}
    </span>
  )
}
