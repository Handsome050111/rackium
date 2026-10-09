import EvidenceSlots from './EvidenceSlots.jsx'

export default function EvidenceUpload({ disabled, children }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 text-sm font-semibold text-text">Evidence</div>
      {children ?? <EvidenceSlots labels={['Front', 'Rear', 'PDU / UPS']} disabled={disabled} />}
    </div>
  )
}
