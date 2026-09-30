// The nine phases, in order (brief v2.3 §3). Overview is a tenth sidebar
// item but is not a phase and has no status.

export const PHASES = [
  { id: 'cmo', name: 'CMO Inventory Validation', shortName: 'CMO', stepperLabel: 'CMO', icon: 'ClipboardCheck' },
  { id: 'survey', name: 'Physical Site Survey', shortName: 'Survey', stepperLabel: 'Survey', icon: 'HardHat' },
  { id: 'hld', name: 'HLD', shortName: 'HLD', stepperLabel: 'HLD', icon: 'Network' },
  { id: 'lld', name: 'LLD', shortName: 'LLD', stepperLabel: 'LLD', icon: 'FileText' },
  { id: 'solution-package', name: 'Solution Package', shortName: 'Solution Package', stepperLabel: 'Sol. Package', icon: 'FileCheck2' },
  { id: 'bom', name: 'BOM', shortName: 'BOM', stepperLabel: 'BOM', icon: 'Database' },
  { id: 'deployment', name: 'Deployment & Installation', shortName: 'Deployment & Installation', stepperLabel: 'Deployment', icon: 'Wrench' },
  { id: 'cmdb', name: 'CMDB', shortName: 'CMDB', stepperLabel: 'CMDB', icon: 'Server' },
  { id: 'handover', name: 'Handover', shortName: 'Handover', stepperLabel: 'Handover', icon: 'PackageCheck' },
]

export const PHASE_ORDER = PHASES.map((p) => p.id)
