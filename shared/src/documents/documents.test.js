import { describe, it, expect } from 'vitest'
import { ctx, lld, hld, deployment, cmdb, bom, exceptions } from './fixtures.js'
import { outline, plainText, toCsv, table } from './model.js'
import { DOCUMENT_TYPES, HANDOVER_TYPES, HANDOVER_FILE_COUNT, requestProblem, fileNameOf } from './types.js'
import {
  hldDocument,
  lldDocument,
  cableWorkbook,
  cableScheduleRows,
  surveyReport,
  solutionPackageDocument,
  bomDocument,
  deploymentReport,
  exceptionRegister,
  asBuiltComparison,
  cmdbExtract,
  dguvReport,
  auditLogDocument,
  executiveSummary,
  photoPaths,
  scheduleHeadings,
} from './assemble.js'
import { topologySvg, rackElevationSvg } from './svg.js'
import { cableLabels, layoutLabels, LABEL_SIZES, connectionPath } from './labels.js'

const titles = (doc) => outline(doc).map((o) => o.title)

describe('document registry', () => {
  it('the 11 handover documents in package order; 13 files', () => {
    expect(HANDOVER_TYPES.map((t) => t.key)).toEqual(['exec-summary', 'survey-report', 'hld-document', 'lld-document', 'cable-matrix', 'bom-final', 'deployment-report', 'cmdb-extract', 'as-built', 'exception-register', 'photo-evidence'])
    expect(HANDOVER_FILE_COUNT).toBe(12)
    expect(DOCUMENT_TYPES.find((t) => t.key === 'solution-package').formats).toEqual(['pdf', 'docx'])
  })
  it('requests: formats, prices only for those who may see them, audit log for its readers', () => {
    expect(requestProblem({ typeKey: 'hld-document', format: 'docx' })).toMatch(/not available as DOCX/)
    expect(requestProblem({ typeKey: 'solution-package', format: 'pdf', options: { prices: 'sell' }, canSeePrices: false })).toMatch(/see prices/)
    expect(requestProblem({ typeKey: 'solution-package', format: 'pdf', options: { prices: 'sell' }, canSeePrices: true })).toBeNull()
    expect(requestProblem({ typeKey: 'hld-document', format: 'pdf', options: { prices: 'sell' }, canSeePrices: true })).toMatch(/has no prices/)
    expect(requestProblem({ typeKey: 'audit-log', format: 'pdf', roles: ['field_engineer'] })).toMatch(/audit log/)
    expect(requestProblem({ typeKey: 'handover-package', format: 'zip' })).toBe('Unknown document type')
    expect(fileNameOf({ buildingCode: 'B001', typeKey: 'hld-document', version: 3, format: 'pdf' })).toBe('B001-hld-document-v3.pdf')
  })
})

describe('diagrams', () => {
  it('topology: every room and device, links in their media colour', () => {
    const out = topologySvg({ floors: hld.floors, rooms: hld.rooms, devices: hld.devices, connections: hld.connections })
    expect(out.startsWith('<svg')).toBe(true)
    for (const s of ['TR-EG-01', 'TR-EG-02', 'B-SW-01', 'E-SW-01', 'Ground floor']) expect(out).toContain(s)
    expect(out).toContain('stroke="#FFD700"') // OS2
  })
  it('rack elevation: front and rear, devices at their RU, escaped labels', () => {
    const out = rackElevationSvg({ code: 'R01', heightU: 42, placements: [{ ru: 40, heightU: 1, face: 'front', mounting: 'rack', kind: 'device', label: 'SW <1> & co' }] })
    expect(out).toContain('Rack R01 (42U)')
    expect(out).toContain('SW &lt;1&gt; &amp; co')
    expect(out).toContain('>Rear<')
  })
})

describe('design documents', () => {
  it('HLD document: overview, topology, inventory, uplinks, approvals', () => {
    const doc = hldDocument(ctx, hld)
    expect(titles(doc)).toEqual(['Overview', 'Physical topology', 'Device inventory', 'Uplinks', 'Approval history'])
    const text = plainText(doc)
    expect(text).toContain('Approved version: v1 (2026-09-01)')
    expect(text).toContain('E-SW-01 | Edge | C9300-48UX | TR-EG-02 | R01')
    expect(text).toContain('B-SW-01 Te1/1/1 | E-SW-01 Te1/1/1 | OS2 | 10G')
    expect(doc.meta).toMatchObject({ project: 'Acme Campus', client: 'Acme Retail', building: 'B001 Headquarters', date: '2026-10-15' })
  })
  it('LLD document: rack elevations, port and cable schedules', () => {
    const doc = lldDocument(ctx, lld)
    expect(titles(doc)).toEqual(['Overview', 'Rack elevations', 'Port schedule', 'Cable schedule'])
    expect(doc.sections[1].blocks).toHaveLength(2)
    const text = plainText(doc)
    expect(text).toContain('E-SW-01 | Gi1/0/1 | RJ45 | A-AP-01 Eth0 | C-EA-1 | Cat6A')
    expect(text).toContain('B-SW-01 | Te1/1/2 | SFP+ | free')
    expect(text).toContain('C-EA-1b | PP-01 | 02 | A-AP-01 | Eth0 | Cat6A | Patch cord | 15')
  })
  it('cable workbook: three sheets, configurable headings with placeholders listed', () => {
    const wb = cableWorkbook(ctx, lld, { headings: { cableId: 'SC Kabel-Nr.' } })
    expect(wb.sheets.map((s) => s.name)).toEqual(['Cable schedule', 'Cable matrix', 'Port schedule'])
    expect(wb.sheets[0].rows[0][0]).toBe('SC Kabel-Nr.')
    expect(wb.sheets[0].rows).toHaveLength(4) // header + 3 cables
    expect(wb.sheets[1].rows.slice(1).map((r) => `${r[0]} ${r[1]}`)).toEqual(['A-AP-01 Eth0', 'B-SW-01 Te1/1/1', 'E-SW-01 Gi1/0/1', 'E-SW-01 Te1/1/1'])
    expect(wb.placeholderHeadings).not.toContain('cableId')
    expect(wb.placeholderHeadings).toContain('fromDevice')
    expect(scheduleHeadings({ media: '  ', bogus: 'x' })).toEqual(scheduleHeadings())
  })
  it('as-built cable schedule uses the installed cable ID and length', () => {
    const rows = cableScheduleRows([{ ...lld.connections[0], status: 'accepted', segments: [{ ...lld.connections[0].segments[0], installed: { cableId: 'C-BE-9', installedM: 52 } }] }], (id) => id)
    expect(rows[0]).toMatchObject({ cableId: 'C-BE-9', lengthM: 52, status: 'Accepted' })
  })
  it('survey report: building tabs, rooms with fields, racks and photos', () => {
    const doc = surveyReport(ctx, { status: 'Approved', buildingFields: [{ tab: 'Site access', status: 'verified', fields: [{ label: 'Access hours', value: '07:00–18:00' }] }], rooms: [{ code: 'TR-EG-01', floorName: 'Ground floor', tabs: [{ tab: 'Room details', status: 'verified', fields: [{ label: 'Cooling', value: 'Yes' }] }], racks: [{ code: 'R01', heightU: 42 }], photos: ['f1', 'f2'] }] })
    expect(titles(doc)).toEqual(['Summary', 'Building', 'Site access (verified)', 'Rooms', 'Room TR-EG-01 · Ground floor'])
    expect(plainText(doc)).toContain('Cooling: Yes')
    expect(doc.sections[2].children[0].blocks.filter((b) => b.type === 'image').map((b) => b.fileId)).toEqual(['f1', 'f2'])
  })
})

describe('Solution Package: 18 sections; prices per M5a rules', () => {
  const sp = { state: 'approved', packageCompleteness: 92, groups: [{ key: 'addressing', n: 1, name: 'Addressing', status: 'complete', addressingEntries: [{ label: 'Users', vlanId: 10, cidr: '10.10.0.0/24', gateway: '10.10.0.1' }] }, { key: 'wireless', n: 2, name: 'Wireless', status: 'in_progress', kvPairs: [{ key: 'SSID', value: 'Acme' }] }], validationAreas: [{ name: 'Topology', result: 'passed', passed: 3, total: 3 }], acceptedWarnings: [{ text: 'Optics: 1 warning', acceptedBy: 'Owner (PM)' }], resourceEstimate: { totalsByTask: { 'install-device': 2 }, totalHours: 1 } }
  it('all 18 sections in order with their content', () => {
    const doc = solutionPackageDocument(ctx, { sp, lld, hld, bom, prices: 'none' })
    expect(titles(doc)).toHaveLength(18)
    expect(titles(doc)[0]).toBe('Document information and scope')
    expect(titles(doc)[17]).toBe('Assumptions, risks, dependencies and open items')
    const text = plainText(doc)
    expect(text).toContain('Users | 10 | 10.10.0.0/24 | 10.10.0.1')
    expect(text).toContain('SSID: Acme')
    expect(text).toContain('Input group 2. Wireless: in_progress')
    expect(text).toContain('Quantities only')
    expect(text).not.toContain('EUR')
  })
  it('client export with selling prices: margin applied, never shown', () => {
    const text = plainText(solutionPackageDocument(ctx, { sp, lld, hld, bom, prices: 'sell', marginPercent: 15 }))
    expect(text).toContain('EUR 11500.00') // 10 000.00 × 1.15
    expect(text).not.toMatch(/margin|15 ?%/i)
  })
})

describe('delivery and as-built documents', () => {
  it('BOM: lines and an Excel sheet; prices only when asked', () => {
    const none = bomDocument(ctx, bom, { prices: 'none' })
    expect(none.sheet.rows[0]).not.toContain('Unit price (EUR)')
    const cost = bomDocument(ctx, bom, { prices: 'cost' })
    expect(cost.sheet.rows[0]).toContain('Unit price (EUR)')
    expect(cost.sheet.rows[1]).toEqual(expect.arrayContaining(['C9500', 10000, 'delivered']))
    expect(plainText(cost.doc)).toContain('Total: EUR 10050.00')
  })
  it('deployment report: installations, tests, exceptions, photos', () => {
    const doc = deploymentReport(ctx, deployment, { photos: { d2: ['f9'] } })
    expect(titles(doc)).toEqual(['Summary', 'Installation records', 'Link tests', 'Exceptions', 'Evidence photos', 'E-SW-01'])
    const text = plainText(doc)
    expect(text).toContain('E-SW-01 | Accepted | FOC123 | 70:b3:17:55:2a:01 | R01 / 30 / front | Fiona | 2026-10-10')
    expect(text).toContain('C-EA-1 (1.2 m)')
    expect(text).toContain('Old router in RU 40')
  })
  it('exception register and as-built comparison', () => {
    expect(plainText(exceptionRegister(ctx, { exceptions }))).toContain('Accepted: 1')
    const text = plainText(asBuiltComparison(ctx, deployment))
    expect(text).toContain('E-SW-01 | RU | 40 | 30 | Exception logged')
    expect(text).toContain('E-SW-01 → A-AP-01 | Length (cable 2) | 15 m | 22 m | Unresolved')
  })
  it('CMDB extract: PDF model, CSV sheet and JSON with provenance', () => {
    const out = cmdbExtract(ctx, cmdb)
    expect(out.sheet.rows[1]).toEqual(['E-SW-01', '—', '—', 'Edge', 'C9300-48UX', 'FOC123', '70:b3:17:55:2a:01', 'TR-EG-02', 'R01', 30, 'Accepted', 'INV-1', '2031-10-01', 'Valid'])
    expect(out.json.records[0]).toMatchObject({ serial: 'FOC123', provenance: { serial: { source: 'deployment' } }, location: { rack: 'R01', ru: 30 } })
    expect(toCsv(out.sheet.rows).split('\r\n')[0]).toBe('Hostname,Legacy hostname,Mode,Role,Model,Serial,MAC,Room,Rack,RU,Status,Asset tag,Warranty end,DGUV')
  })
  it('DGUV report counts every status, not inspected included', () => {
    const out = dguvReport(ctx, { settings: { intervalMonths: 48, expiringSoonDays: 90, expiringDays: 30 }, devices: [{ label: 'E-SW-01', room: 'TR-EG-02', lastInspectionDate: '2026-10-01', inspector: 'Meyer', dueDate: '2030-10-01', status: 'valid' }, { label: 'B-SW-01', status: null }] })
    const text = plainText(out.doc)
    expect(text).toContain('Valid: 1')
    expect(text).toContain('Not inspected: 1')
    expect(out.sheet.rows[2]).toEqual(['B-SW-01', '—', 'Not inspected', '—', '—', 'Not inspected'])
  })
  it('audit log export and the executive summary', () => {
    const audit = auditLogDocument(ctx, { filters: { action: 'deployment' }, entries: [{ occurredAt: '2026-10-14T09:30:00Z', actorName: 'Fiona', action: 'deployment.device.installed', objectType: 'Device', objectId: 'abcdef123456', changeType: 'as_built', comment: '=cmd' }] })
    expect(audit.sheet.rows[1]).toEqual(['2026-10-14 09:30', 'Fiona', 'deployment.device.installed', 'Device 123456', 'as_built', '=cmd'])
    expect(toCsv(audit.sheet.rows)).toContain(",'=cmd")
    const summary = executiveSummary(ctx, { phases: [{ phaseKey: 'hld', status: 'approved' }], kpis: { devices: 4, connectionStatus: { designed: 2, installed: 1, accepted: 1 }, completionPercent: 80 }, dguv: { notInspected: 1 }, pipeline: deployment.pipeline, exceptions, documents: [{ name: 'HLD document', format: 'PDF' }], baseline: null })
    expect(plainText(summary)).toContain('HLD | Approved')
    expect(plainText(summary)).toContain('DGUV not inspected: 1')
  })
  it('photo pack paths: by room, rack and device; unique; safe names', () => {
    expect(photoPaths([{ id: '1', fileName: 'a.jpg', room: 'TR-EG-01', rack: 'R01' }, { id: '2', fileName: 'a.jpg', room: 'TR-EG-01', rack: 'R01' }, { id: '3', fileName: '../x?.jpg', room: null }]).map((x) => x.path)).toEqual(['TR-EG-01/R01/a.jpg', 'TR-EG-01/R01/2-a.jpg', 'Building/.._x_.jpg'])
  })
})

describe('cable labels', () => {
  it('two labels per cable, one per end, each naming the far end', () => {
    const labels = cableLabels([{ id: 'c2', segments: [{ cableId: 'C-EA-1', from: { name: 'E-SW-01', portId: 'Gi1/0/1' }, to: { name: 'PP-01', portId: '01' } }] }])
    expect(labels).toEqual([
      { connectionId: 'c2', cableId: 'C-EA-1', here: 'E-SW-01 Gi1/0/1', far: 'PP-01 01', end: 'A' },
      { connectionId: 'c2', cableId: 'C-EA-1', here: 'PP-01 01', far: 'E-SW-01 Gi1/0/1', end: 'B' },
    ])
    expect(connectionPath('o', 'p', 'c2')).toBe('/l/o/p/c/c2')
  })
  it('sheet layout: positions per stock, new page when full', () => {
    const many = Array.from({ length: 66 }, (_, i) => ({ n: i }))
    const out = layoutLabels(many, 'avery-l7651')
    expect(out[0]).toMatchObject({ page: 0, x: 4.7, y: 10.7 })
    expect(out[1].x).toBeCloseTo(4.7 + 38.1 + 2.5)
    expect(out[5]).toMatchObject({ page: 0, x: 4.7 })
    expect(out[65].page).toBe(1)
    expect(layoutLabels([{}, {}], 'brady-54x25').map((x) => x.page)).toEqual([0, 1])
    expect(LABEL_SIZES.every((s) => s.marginLeft + s.cols * s.width + (s.cols - 1) * s.gapX <= s.page.width + 0.01)).toBe(true)
    expect(() => layoutLabels([], 'nope')).toThrow(/Unknown label size/)
  })
})

describe('model helpers', () => {
  it('tables, outline numbering, CSV escaping', () => {
    const t = table(['a', { key: 'b', label: 'B' }], [{ a: null, b: 2 }])
    expect(t.rows).toEqual([{ a: '—', b: 2 }])
    expect(outline({ sections: [{ id: 'x', title: 'X', blocks: [], children: [{ id: 'y', title: 'Y', blocks: [] }] }] })).toEqual([
      { id: 'x', n: '1', title: 'X', depth: 0 },
      { id: 'y', n: '1.1', title: 'Y', depth: 1 },
    ])
    expect(toCsv([['a,b', 'q"x', '+1']])).toBe('"a,b","q""x",\'+1\r\n')
  })
})

describe('handover checklist and workflow', async () => {
  const { handoverChecklist, checklistReady, shownState, handoverActionProblem, handoverPhaseStatus } = await import('./handover.js')
  const green = { surveyVerified: true, hldApproved: true, lldApproved: true, spApproved: true, bom: { approved: true, lines: 5, undelivered: 0 }, deployment: { planned: 5, accepted: 5 }, cmdb: { designCount: 5, cmdbCount: 5 }, exceptions: { open: 0, rejectedUncorrected: 0 } }
  it('calculated from every phase; each item says what is missing', () => {
    expect(checklistReady(handoverChecklist(green))).toBe(true)
    const items = handoverChecklist({ ...green, bom: { approved: true, lines: 5, undelivered: 2 }, deployment: { planned: 5, accepted: 3 }, exceptions: { open: 1 } })
    expect(items.filter((i) => !i.ok).map((i) => [i.id, i.detail])).toEqual([
      ['bom', '2 of 5 line(s) not yet Delivered'],
      ['deployment', '3 of 5 device(s) accepted'],
      ['exceptions', '1 open exception(s)'],
    ])
    expect(handoverChecklist({ ...green, deployment: { planned: 0, accepted: 0 } }).find((i) => i.id === 'deployment').ok).toBe(false)
  })
  it('Ready is pending with the checklist green; steps by role', () => {
    expect(shownState('pending', true)).toBe('ready')
    expect(shownState('pending', false)).toBe('pending')
    expect(handoverActionProblem('compile', { state: 'pending', ready: false, roles: ['pm'] })).toMatch(/checklist/)
    expect(handoverActionProblem('compile', { state: 'pending', ready: true, roles: ['architect'] })).toMatch(/Only a PM/)
    expect(handoverActionProblem('compile', { state: 'accepted', ready: true, roles: ['pm'] })).toMatch(/Accepted/)
    expect(handoverActionProblem('review', { state: 'compiled', roles: ['reviewer'] })).toBeNull()
    expect(handoverActionProblem('deliver', { state: 'compiled', roles: ['pm'] })).toMatch(/reviewed/)
    expect(handoverPhaseStatus('delivered')).toBe('awaiting_approval')
    expect(handoverPhaseStatus('accepted')).toBe('approved')
    expect(handoverPhaseStatus(null)).toBe('not_started')
  })
})

describe('M6b review: survey tables, photo cap, cost prices', async () => {
  const { surveyTabForReport, cellText } = await import('./survey.js')
  const { capImages, image, section: sec, plainText: text } = await import('./model.js')
  const { requestProblem: problem, clientShareProblem, isInternal } = await import('./types.js')
  const { surveyReport: report } = await import('./assemble.js')
  const tabDef = {
    tab: 'Rack Layout',
    sections: [
      { section: 'Room facts', layout: 'key_value', fields: [{ key: 'cooling', label: 'Cooling', type: 'yes_no' }, { key: 'photos', label: 'Photos', type: 'photo_multi' }] },
      { section: 'Racks in the room', layout: 'table', fields: [{ key: 'width', label: 'Width (mm)', type: 'number' }, { key: 'location', label: 'GPS', type: 'gps' }] },
      { section: 'Passive requirements', layout: 'item_list', item_columns: ['details', 'photograph'], fields: [{ key: 'ladder', label: 'Ladder requirement' }] },
    ],
  }
  const record = {
    tab: 'Rack Layout',
    status: 'verified',
    sections: [
      { sectionIndex: 0, layout: 'key_value', fieldValues: [{ key: 'cooling', value: true }, { key: 'photos', value: { fileIds: ['p1', 'p2'] } }] },
      { sectionIndex: 1, layout: 'table', rows: [{ rackId: 'k1', fieldValues: [{ key: 'width', value: 600 }, { key: 'location', value: { lat: 52.5, lng: 13.4 } }] }, { rackId: 'k2', fieldValues: [{ key: 'width', value: 800 }] }] },
      { sectionIndex: 2, layout: 'item_list', rows: [{ rowKey: 'ladder', fieldValues: [{ key: 'details', value: '3 m' }, { key: 'photograph', value: { fileIds: ['p3'] } }] }] },
    ],
  }
  it('table and item-list sections become full tables (rows and columns), per-rack rows name their rack', () => {
    const t = surveyTabForReport(tabDef, record, { rackCodeOf: (id) => ({ k1: 'R01', k2: 'R02' })[id] })
    expect(t.fields).toEqual([{ label: 'Cooling', value: 'Yes' }, { label: 'Photos', value: '2 photo(s)' }])
    expect(t.tables[0]).toEqual({ title: 'Racks in the room', columns: [{ key: '__rack', label: 'Rack' }, { key: 'width', label: 'Width (mm)' }, { key: 'location', label: 'GPS' }], rows: [{ __rack: 'R01', width: '600', location: '52.5, 13.4' }, { __rack: 'R02', width: '800' }] })
    expect(t.tables[1].rows).toEqual([{ __item: 'Ladder requirement', details: '3 m', photograph: '1 photo(s)' }])
    expect(t.photos).toEqual(['p1', 'p2', 'p3'])
    expect(cellText({ type: 'file' }, { fileIds: ['f'] })).toBe('1 file(s)')
  })
  it('the survey report prints the tables in full (not row counts)', () => {
    const tab = surveyTabForReport(tabDef, record, { rackCodeOf: (id) => id })
    const out = text(report(ctx, { status: 'Verified', buildingFields: [], rooms: [{ code: 'TR-01', tabs: [tab], racks: [], photos: [] }] }))
    expect(out).toContain('Racks in the room')
    expect(out).toContain('Rack | Width (mm) | GPS')
    expect(out).toContain('k1 | 600 | 52.5, 13.4')
    expect(out).toContain('Ladder requirement | 3 m | 1 photo(s)')
    expect(out).not.toMatch(/\d+ row\(s\)/)
  })
  it('photos beyond the cap are left out with a note where they were cut and at the start', () => {
    const doc = { sections: [sec('a', 'A', [image('1'), image('2')]), sec('b', 'B', [image('3'), image('4'), image('5')])] }
    expect(capImages(doc, 3)).toBe(2)
    expect(doc.sections[1].blocks.filter((b) => b.type === 'image')).toHaveLength(1)
    expect(doc.sections[1].blocks.at(-1).text).toBe('2 further photo(s) of this section are not printed here — they are in the photo evidence ZIP.')
    expect(doc.sections[0].blocks[0].text).toBe('This document prints the first 3 photos; 2 further photo(s) are in the photo evidence ZIP.')
    expect(capImages({ sections: [sec('a', 'A', [image('1')])] }, 3)).toBe(0)
  })
  it('cost prices: Org Admin, PM and Reviewer only; never shared with a client', () => {
    const ask = (roles, canSeePrices = true) => problem({ typeKey: 'bom-final', format: 'pdf', options: { prices: 'cost' }, roles, canSeePrices })
    expect(ask(['pm'])).toBeNull()
    expect(ask(['org_admin'])).toBeNull()
    expect(ask(['reviewer'], false)).toBeNull()
    expect(ask(['architect'])).toMatch(/Org Admin, PM or Reviewer/)
    expect(ask(['field_engineer'])).toMatch(/Org Admin, PM or Reviewer/)
    expect(isInternal({ options: { prices: 'cost' } })).toBe(true)
    expect(clientShareProblem({ fileName: 'B001-bom-final-v3.pdf', options: { prices: 'cost' } })).toBe('B001-bom-final-v3.pdf is internal (cost prices) and cannot be shared with a client')
    expect(clientShareProblem({ options: { prices: 'sell' } })).toBeNull()
    expect(clientShareProblem({ options: {} })).toBeNull()
  })
})
