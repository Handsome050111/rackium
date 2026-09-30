// Organisation → Project → Country → SAL → Campus → Building hierarchy
// (brief v2.3 §4.1). This is the one dataset every screen reads from,
// through client/src/api/ only.

export const organisation = { id: 'org-technonex', name: 'Technonex' }

export const project = { id: 'proj-lanspire', organisationId: 'org-technonex', name: 'LANspire' }

export const country = { id: 'country-de', projectId: 'proj-lanspire', code: 'DE', name: 'Germany' }

export const sal = { id: 'sal-erl', countryId: 'country-de', code: 'ERL' }

export const campus = { id: 'campus-c01', salId: 'sal-erl', code: 'C01' }

// Phase statuses per building. "Pending" is never used (brief v2.3 §4.4);
// unreached future phases are "not_started", not red.
export const buildings = [
  {
    id: 'b001',
    campusId: 'campus-c01',
    code: 'B001',
    name: 'Building B001',
    nextMilestone: 'Solution Package submission',
    lastSyncAt: '2026-09-29T09:15:00Z',
    phases: {
      cmo: { status: 'completed' },
      survey: { status: 'approved' },
      hld: { status: 'approved' },
      lld: { status: 'in_progress' },
      'solution-package': { status: 'not_started' },
      bom: { status: 'in_progress', subLabel: 'Draft' },
      deployment: { status: 'not_started' },
      cmdb: { status: 'not_started' },
      handover: { status: 'not_started' },
    },
    openItems: [
      {
        id: 'b001-blk-1',
        type: 'blocker',
        phaseId: 'lld',
        title: 'RU conflict on rack UG1705-R01',
        detail: 'Two placements target RU32 on rack UG1705-R01.',
      },
      {
        id: 'b001-blk-2',
        type: 'blocker',
        phaseId: 'bom',
        title: 'Catalogue price missing for OS2 SFP',
        detail: 'Draft BOM line cannot total until a unit price is entered.',
      },
      {
        id: 'b001-apr-1',
        type: 'approval',
        phaseId: 'hld',
        title: 'HLD v2 revision',
        detail: 'Reviewer approval requested after a Border uplink change.',
      },
    ],
    history: [
      {
        id: 'b001-hist-1',
        at: '2026-09-29T06:00:00Z',
        label: 'LLD design updated',
        phaseId: 'lld',
      },
      {
        id: 'b001-hist-2',
        at: '2026-09-28T08:30:00Z',
        label: 'HLD approved',
        phaseId: 'hld',
      },
      {
        id: 'b001-hist-3',
        at: '2026-09-27T14:00:00Z',
        label: 'Physical site survey completed',
        phaseId: 'survey',
      },
      {
        id: 'b001-hist-4',
        at: '2026-09-26T11:45:00Z',
        label: 'CMO inventory validated',
        phaseId: 'cmo',
      },
    ],
  },
  {
    id: 'b002',
    campusId: 'campus-c01',
    code: 'B002',
    name: 'Building B002 · Production',
    nextMilestone: 'Physical site survey verification',
    lastSyncAt: '2026-09-28T16:40:00Z',
    phases: {
      cmo: { status: 'completed' },
      survey: { status: 'in_progress' },
      hld: { status: 'not_started' },
      lld: { status: 'not_started' },
      'solution-package': { status: 'not_started' },
      bom: { status: 'not_started' },
      deployment: { status: 'not_started' },
      cmdb: { status: 'not_started' },
      handover: { status: 'not_started' },
    },
    openItems: [
      {
        id: 'b002-blk-1',
        type: 'blocker',
        phaseId: 'cmo',
        title: '3 unassigned devices at SAL ERL',
        detail: 'Devices with no building must be assigned by the PM before CMO can close out.',
      },
    ],
    history: [
      {
        id: 'b002-hist-1',
        at: '2026-09-28T16:40:00Z',
        label: 'Rack Layout tab submitted for TR-P-01',
        phaseId: 'survey',
      },
      {
        id: 'b002-hist-2',
        at: '2026-09-25T10:00:00Z',
        label: 'CMO inventory validated',
        phaseId: 'cmo',
      },
    ],
  },
  {
    id: 'b003',
    campusId: 'campus-c01',
    code: 'B003',
    name: 'Building B003 · Logistics',
    nextMilestone: 'CMO inventory validation',
    lastSyncAt: '2026-09-24T13:05:00Z',
    phases: {
      cmo: { status: 'in_progress' },
      survey: { status: 'not_started' },
      hld: { status: 'not_started' },
      lld: { status: 'not_started' },
      'solution-package': { status: 'not_started' },
      bom: { status: 'not_started' },
      deployment: { status: 'not_started' },
      cmdb: { status: 'not_started' },
      handover: { status: 'not_started' },
    },
    openItems: [],
    history: [
      {
        id: 'b003-hist-1',
        at: '2026-09-24T13:05:00Z',
        label: 'CMO Excel import started',
        phaseId: 'cmo',
      },
    ],
  },
]

export function getBuildingById(id) {
  return buildings.find((b) => b.id === id)
}
