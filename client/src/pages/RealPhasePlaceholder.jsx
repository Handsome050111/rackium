import { useParams } from 'react-router-dom'

const PHASE_NAMES = {
  cmo: 'CMO Inventory Validation',
  survey: 'Physical Site Survey',
  hld: 'HLD',
  lld: 'LLD',
  'solution-package': 'Solution Package',
  bom: 'BOM',
  deployment: 'Deployment & Installation',
  cmdb: 'CMDB',
  handover: 'Handover',
}

// Shown for every phase module in real mode — only the dashboard and project
// setup are built in M2 (item 9: "available in a later milestone").
export default function RealPhasePlaceholder() {
  const { phaseKey } = useParams()
  return (
    <div className="p-6">
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-base font-semibold text-text">{PHASE_NAMES[phaseKey] ?? phaseKey}</h1>
        <p className="mt-2 text-sm text-text-secondary">This workspace is available in a later milestone.</p>
      </div>
    </div>
  )
}
