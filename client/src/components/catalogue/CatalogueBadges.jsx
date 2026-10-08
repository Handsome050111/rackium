const LAYER_LABEL = { seeded: 'Seeded', servon: 'SERVON', organisation: 'Organisation', project: 'Project' }
const LAYER_CLASS = {
  seeded: 'bg-surface-muted text-text-secondary',
  servon: 'bg-surface-muted text-text-secondary',
  organisation: 'bg-brand/10 text-brand',
  project: 'bg-brand/10 text-brand',
}

export function LayerBadge({ layer }) {
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${LAYER_CLASS[layer]}`}>{LAYER_LABEL[layer]}</span>
}

// Seeded rows are the prototype's models until Technonex supplies the real
// catalogue (brief v2.3 §6.5).
export function PlaceholderBadge() {
  return (
    <span title="Placeholder data until the supplied catalogue replaces it" className="whitespace-nowrap rounded bg-status-amber/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-status-amber">
      Placeholder
    </span>
  )
}
