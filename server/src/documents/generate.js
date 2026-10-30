import mongoose from 'mongoose'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { getTabDefinition } from '@rackium/shared/surveyForm.js'
import { toCsv, sheetOf, capImages } from '@rackium/shared/documents/model.js'
import { surveyTabForReport } from '@rackium/shared/documents/survey.js'
import { HANDOVER_TYPES, typeOf, isInternal, INTERNAL_COST_MARK } from '@rackium/shared/documents/types.js'
import { cableLabels, layoutLabels, labelSize, connectionPath } from '@rackium/shared/documents/labels.js'
import * as A from '@rackium/shared/documents/assemble.js'
import { REPORT_ASSEMBLERS, reportCsv } from '@rackium/shared/documents/reports.js'
import { topologySvg } from '@rackium/shared/documents/svg.js'
import { canSeePrices } from '@rackium/shared/policy.js'
import { SurveyTabRecord } from '../models/surveyTabRecord.js'
import { File } from '../models/file.js'
import { conflict } from '../http/errors.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { Device } from '../models/device.js'
import { DeploymentException } from '../models/deploymentException.js'
import { HandoverBaseline } from '../models/handoverBaseline.js'
import { dguvDevices } from '../deployment/asBuilt.js'
import { orgTimeSettings } from '../organisations/timeSettings.js'
import { projectSettings } from '../delivery/common.js'
// The renderers (Chromium, pdf.js, docx, xlsx, jszip) load on first use only:
// every other module — and every test file that does not render — stays light.
const pdfRenderer = () => import('./render/pdf.js')
const officeRenderer = () => import('./render/office.js')
const renderXlsx = async (sheets) => (await officeRenderer()).renderXlsx(sheets)
const renderZip = async (entries) => (await officeRenderer()).renderZip(entries)
const svgToPng = async (svg, o) => (await officeRenderer()).svgToPng(svg, o)
const renderDocx = async (doc, o) => (await officeRenderer()).renderDocx(doc, o)
const renderPdf = async (doc, o) => (await pdfRenderer()).renderPdf(doc, o)
const renderLabelsPdf = async (o) => (await pdfRenderer()).renderLabelsPdf(o)
// An internal (cost price) workbook: the mark on the first row of every sheet.
const markSheets = (sheets, internal) => (internal ? sheets.map((s) => ({ ...s, rows: [[INTERNAL_COST_MARK], ...s.rows] })) : sheets)
import { appUrl } from '../notifications/notify.js'

const PHOTO_CATEGORIES = ['photo_room', 'photo_rack', 'photo_reference', 'photo_device_label', 'evidence']
const MAX_PHOTOS_PER_DOCUMENT = 120

// File ids → JPEG data URIs (reduced to print size), for PDFs and Word.
async function imagesFor(storage, fileIds) {
  const out = new Map()
  const files = await File.find({ _id: { $in: [...new Set(fileIds)].slice(0, MAX_PHOTOS_PER_DOCUMENT).map((id) => new mongoose.Types.ObjectId(String(id))) }, deletedAt: null, mimeType: /^image\// }).lean()
  for (const f of files) {
    try {
      const jpg = await sharp(await storage.read(f.storageKey)).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
      out.set(String(f._id), `data:image/jpeg;base64,${jpg.toString('base64')}`)
    } catch {
      // An unreadable photo is left out (the document says so), never fails the document.
    }
  }
  return out
}
const collectImageIds = (doc) => {
  const ids = []
  const walk = (sections) => sections.forEach((s) => (s.blocks.forEach((b) => b.type === 'image' && ids.push(b.fileId)), walk(s.children ?? [])))
  walk(doc.sections)
  return ids
}


// The survey report's data: every tab record with its labelled values, rooms
// with racks and photos.
async function surveyData(req, building, services) {
  const structure = await services.survey.structure.building(req, building.id)
  const tree = structure.tree?.[0] ?? { floors: [] }
  const records = await SurveyTabRecord.find({ buildingId: building.id }).lean()
  const photoFiles = await File.find({ buildingId: building.id, deletedAt: null, category: { $in: PHOTO_CATEGORIES }, 'attachedTo.type': { $in: ['surveyTabRecord', 'room', 'rack'] } }, { attachedTo: 1 }).lean()
  const racks = await Rack.find({ buildingId: building.id }).lean()
  // Every section in full: tables as tables (M6b review), labels from the template.
  const rackCode = new Map(racks.map((k) => [String(k._id), k.code]))
  const tabView = (rec) => surveyTabForReport(getTabDefinition(rec.tab), rec, { rackCodeOf: (id) => rackCode.get(String(id)) ?? null })
  const roomPhotos = (roomId) => {
    const recIds = new Set(records.filter((r) => String(r.roomId) === String(roomId)).map((r) => String(r._id)))
    const rackIds = new Set(racks.filter((k) => String(k.roomId) === String(roomId)).map((k) => String(k._id)))
    return photoFiles.filter((f) => (f.attachedTo.type === 'room' && String(f.attachedTo.id) === String(roomId)) || (f.attachedTo.type === 'surveyTabRecord' && recIds.has(String(f.attachedTo.id))) || (f.attachedTo.type === 'rack' && rackIds.has(String(f.attachedTo.id)))).map((f) => String(f._id))
  }
  const rooms = tree.floors.flatMap((fl) => fl.rooms.map((r) => ({ id: r.id, code: r.code, floorName: fl.name ?? fl.token, tabs: records.filter((x) => String(x.roomId) === r.id && x.hasData).map(tabView), racks: racks.filter((k) => String(k.roomId) === r.id).map((k) => ({ code: k.code, heightU: k.heightU })), photos: roomPhotos(r.id) })))
  const buildingFields = records.filter((x) => !x.roomId && x.hasData).map(tabView)
  const buildingRecIds = new Set(records.filter((x) => !x.roomId).map((x) => String(x._id)))
  const buildingPhotos = photoFiles.filter((f) => f.attachedTo.type === 'surveyTabRecord' && buildingRecIds.has(String(f.attachedTo.id))).map((f) => String(f._id))
  const verified = records.length > 0 && records.every((r) => ['verified', 'imported'].includes(r.status))
  return { status: verified ? 'Verified' : 'In progress', buildingFields, buildingPhotos, rooms }
}

// Every photo of the building, organised by room / rack / device (ZIP pack).
async function photoPack(storage, building, services, req) {
  const files = await File.find({ buildingId: building.id, deletedAt: null, mimeType: /^image\// }).lean()
  const [rooms, racks, records, devices, exceptions] = await Promise.all([Room.find({ buildingId: building.id }).lean(), Rack.find({ buildingId: building.id }).lean(), SurveyTabRecord.find({ buildingId: building.id }, { roomId: 1, tab: 1 }).lean(), Device.find({ buildingId: building.id }, { hostname: 1, label: 1, roomId: 1, rackId: 1 }).lean(), DeploymentException.find({ buildingId: building.id }, { deviceId: 1 }).lean()])
  const roomCode = new Map(rooms.map((r) => [String(r._id), r.code]))
  const rackOf = new Map(racks.map((k) => [String(k._id), k]))
  const deviceOf = new Map(devices.map((d) => [String(d._id), d]))
  const placeOf = (f) => {
    const id = String(f.attachedTo.id)
    switch (f.attachedTo.type) {
      case 'room':
        return { room: roomCode.get(id) }
      case 'rack':
        return { room: roomCode.get(String(rackOf.get(id)?.roomId)), rack: rackOf.get(id)?.code }
      case 'surveyTabRecord': {
        const rec = records.find((r) => String(r._id) === id)
        return { room: rec?.roomId ? roomCode.get(String(rec.roomId)) : 'Building' }
      }
      case 'device':
      case 'deploymentException': {
        const d = deviceOf.get(f.attachedTo.type === 'device' ? id : String(exceptions.find((e) => String(e._id) === id)?.deviceId))
        return { room: roomCode.get(String(d?.roomId)) ?? 'Unplaced', rack: rackOf.get(String(d?.rackId))?.code, device: d?.hostname ?? d?.label }
      }
      default:
        return { room: 'Other' }
    }
  }
  const items = files.filter((f) => !['approval', 'designVersion', 'generatedDocument'].includes(f.attachedTo.type)).map((f) => ({ id: String(f._id), fileName: f.fileName, storageKey: f.storageKey, ...placeOf(f) }))
  const paths = A.photoPaths(items)
  const entries = []
  for (const { id, path } of paths) {
    const f = items.find((x) => x.id === id)
    try {
      entries.push({ path, data: await storage.read(f.storageKey) })
    } catch {
      // A missing file is listed in the manifest as missing, never fails the pack.
    }
  }
  entries.push({ path: 'manifest.csv', data: toCsv([['Path', 'Room', 'Rack', 'Device', 'Original name'], ...paths.map(({ id, path }) => {
    const f = items.find((x) => x.id === id)
    return [path, f.room ?? '', f.rack ?? '', f.device ?? '', f.fileName]
  })]) })
  return entries
}

const marginOf = async () => (await projectSettings()).marginPercent

// Generates one document: { buffer, pageCount }. `job`: the generatedDocuments row;
// `req`: the requester's context; `branding`: organisation and client logos.
export async function generate({ job, req, building, services, storage, branding, onStep, settings }) {
  const options = job.options ?? {}
  const ctx = { project: req.project.summary, building: building ? { code: building.code, name: building.name } : null, versionLabel: `v${job.version}`, generatedAt: job.requestedAt }
  const internal = isInternal(job)
  const pdf = async (doc) => {
    if (internal) doc.internal = true
    // At most MAX_PHOTOS_PER_DOCUMENT photos printed; the document says where the rest are.
    capImages(doc, MAX_PHOTOS_PER_DOCUMENT)
    onStep('Collecting photos')
    const images = await imagesFor(storage, collectImageIds(doc))
    const out = await renderPdf(doc, { branding, watermark: job.watermark, images, onStep })
    return out
  }
  const priceRules = { prices: options.prices ?? 'none' }
  onStep('Reading the data')
  // The seven standard reports (M7a-3): read with the requester's roles and scope.
  if (typeOf(job.typeKey)?.report) {
    const data = await services.reports.load(job.typeKey, req, { now: job.requestedAt ?? new Date(), options })
    const out = REPORT_ASSEMBLERS[job.typeKey](ctx, data, priceRules)
    if (job.format === 'xlsx') return { buffer: await renderXlsx(markSheets(out.sheets, internal)) }
    if (job.format === 'csv') return { buffer: Buffer.from(`﻿${reportCsv(out.sheets, { internal })}`, 'utf8') }
    return pdf(out.doc)
  }
  switch (job.typeKey) {
    case 'hld-document': {
      const v = await services.hld.view(req, building.id)
      const data = { ...v, version: v.versions?.find((x) => x.frozen) ?? v.versions?.[0] ?? null }
      return pdf(A.hldDocument(ctx, data))
    }
    case 'lld-document': {
      const v = await services.lld.view(req, building.id)
      if (!v.started) throw conflict('not_ready', 'This building has no LLD yet')
      return pdf(A.lldDocument(ctx, v, { headings: settings.headings }))
    }
    case 'cable-matrix': {
      const dep = await services.deployment.view(req, building.id)
      const v = await services.lld.view(req, building.id)
      if (!v.started) throw conflict('not_ready', 'This building has no LLD yet')
      // As built where installed: the cable IDs and lengths recorded on site.
      const installedById = new Map((dep.connections ?? []).map((c) => [c.id, c]))
      const connections = v.connections.map((c) => {
        const d = installedById.get(c.id)
        return d ? { ...c, status: d.status, segments: c.segments.map((s) => ({ ...s, installed: d.segments.find((x) => x.index === s.index)?.installed ?? null })) } : c
      })
      const wb = A.cableWorkbook(ctx, { ...v, connections }, { headings: settings.headings })
      return { buffer: await renderXlsx(wb.sheets) }
    }
    case 'survey-report':
      return pdf(A.surveyReport(ctx, await surveyData(req, building, services)))
    case 'solution-package': {
      const [sp, hld, lld, bom] = await Promise.all([services.delivery.solutionPackage.view(req, building.id), services.hld.view(req, building.id), services.lld.view(req, building.id), services.delivery.bom.view(req, building.id)])
      const doc = A.solutionPackageDocument(ctx, { sp, hld, lld: lld.started ? lld : null, bom, prices: priceRules.prices, marginPercent: await marginOf(), headings: settings.headings })
      if (job.format === 'docx') {
        onStep('Writing the Word document')
        if (internal) doc.internal = true
        return { buffer: await renderDocx(doc, { branding }) }
      }
      return pdf(doc)
    }
    case 'bom-final': {
      const bom = await services.delivery.bom.view(req, building.id)
      const out = A.bomDocument(ctx, bom, { prices: priceRules.prices, marginPercent: await marginOf() })
      return job.format === 'xlsx' ? { buffer: await renderXlsx(markSheets([out.sheet], internal)) } : pdf(out.doc)
    }
    case 'deployment-report': {
      const dep = await services.deployment.view(req, building.id)
      if (!dep.started) throw conflict('not_ready', 'This building has no LLD yet')
      const files = await File.find({ buildingId: building.id, deletedAt: null, 'attachedTo.type': 'device', mimeType: /^image\// }, { attachedTo: 1 }).lean()
      const photos = {}
      for (const f of files) (photos[String(f.attachedTo.id)] ??= []).push(String(f._id))
      return pdf(A.deploymentReport(ctx, dep, { photos }))
    }
    case 'exception-register': {
      const dep = await services.deployment.view(req, building.id)
      return pdf(A.exceptionRegister(ctx, { exceptions: dep.exceptions ?? [] }))
    }
    case 'as-built': {
      const dep = await services.deployment.view(req, building.id)
      if (!dep.started) throw conflict('not_ready', 'This building has no LLD yet')
      return pdf(A.asBuiltComparison(ctx, dep))
    }
    case 'cmdb-extract': {
      const cmdb = await services.cmdb.view(req, building.id)
      const out = A.cmdbExtract(ctx, { records: cmdb.records ?? [], connections: cmdb.connections ?? [], cableMatrix: cmdb.cableMatrix ?? [], retiredRecords: cmdb.retiredRecords ?? [] })
      if (job.format === 'csv') return { buffer: Buffer.from(`﻿${toCsv(out.sheet.rows)}`, 'utf8') }
      if (job.format === 'json') return { buffer: Buffer.from(JSON.stringify(out.json, null, 2), 'utf8') }
      return pdf(out.doc)
    }
    case 'dguv-report': {
      const { dguv } = await orgTimeSettings(req.org.id)
      const list = await dguvDevices({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id })
      const rooms = new Map((await Room.find({ buildingId: building.id }, { code: 1 }).lean()).map((r) => [String(r._id), r.code]))
      const devs = await Device.find({ _id: { $in: list.map((d) => d.device._id) } }, { roomId: 1 }).lean()
      const roomOf = new Map(devs.map((d) => [String(d._id), rooms.get(String(d.roomId))]))
      const out = A.dguvReport(ctx, { settings: dguv, devices: list.map((d) => ({ label: d.label, room: roomOf.get(String(d.device._id)), lastInspectionDate: d.rec.dguv?.lastInspectionDate ?? null, inspector: d.rec.dguv?.inspector ?? null, dueDate: d.status?.dueDate ?? null, status: d.exempt ? 'exempt' : d.inspected ? d.status.status : null, exemptReason: d.exemptReason ?? null })) })
      return job.format === 'xlsx' ? { buffer: await renderXlsx([out.sheet, out.exemptSheet]) } : pdf(out.doc)
    }
    case 'topology-diagram': {
      const v = await services.hld.view(req, building.id)
      const markup = topologySvg({ floors: v.floors, rooms: v.rooms, devices: v.devices, connections: v.connections, title: `${building.code} physical topology` })
      return { buffer: job.format === 'svg' ? Buffer.from(markup, 'utf8') : await svgToPng(markup) }
    }
    case 'audit-log': {
      const query = { ...(options.filters ?? {}), projectId: req.project.id }
      const { entries, truncated } = await services.auditLog.entriesForExport({ userId: job.requestedBy, organisationId: req.org.id, roles: job.requestedRoles, query })
      const out = A.auditLogDocument(ctx, { filters: options.filters ?? {}, entries, truncated })
      if (job.format === 'csv') return { buffer: Buffer.from(`﻿${toCsv(out.sheet.rows)}`, 'utf8') }
      return pdf(out.doc)
    }
    case 'exec-summary': {
      const dash = await services.dashboard.getBuildingDashboard({ buildingId: building.id, activePhases: req.project.doc.activePhases ?? [], isOrgAdmin: job.requestedRoles.includes('org_admin') })
      const dep = await services.deployment.view(req, building.id)
      const baseline = await HandoverBaseline.findOne({ buildingId: building.id }).sort({ number: -1 }).lean()
      return pdf(A.executiveSummary(ctx, { phases: dash.phases, kpis: dash.kpis, dguv: dash.dguv, pipeline: dep.pipeline, exceptions: dep.exceptions ?? [], documents: HANDOVER_TYPES.map((t) => ({ name: t.name, format: t.handover.map((f) => f.toUpperCase()).join(' + ') })), baseline }))
    }
    case 'photo-evidence':
      onStep('Collecting photos')
      return { buffer: await renderZip(await photoPack(storage, building, services, req)) }
    case 'cable-labels': {
      const size = labelSize(options.labelSize)
      if (!size) throw conflict('not_ready', 'Choose a label size')
      const dep = await services.deployment.view(req, building.id)
      const chosen = new Set((options.connectionIds ?? []).map(String))
      const connections = (dep.connections ?? []).filter((c) => chosen.has(c.id)).map((c) => ({ id: c.id, segments: c.segments.map((s) => ({ cableId: s.installed?.cableId ?? s.cableId, from: { name: s.from.name, portId: s.from.portId }, to: { name: s.to.name, portId: s.to.portId } })) }))
      if (!connections.length) throw conflict('not_ready', 'None of the chosen connections is in this building')
      const qr = new Map()
      for (const c of connections) qr.set(c.id, await QRCode.toString(`${appUrl()}${connectionPath(req.org.id, req.project.id, c.id)}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }))
      onStep('Printing labels')
      const buffer = await renderLabelsPdf({ size, placed: layoutLabels(cableLabels(connections), size.key), qr })
      return { buffer }
    }
    default:
      throw conflict('not_ready', `${typeOf(job.typeKey)?.name ?? job.typeKey} cannot be generated here`)
  }
}

// What a price-bearing request may contain (M5a rule), for the service.
export const pricesAllowed = (roles, org) => canSeePrices(roles, { architectsSeePrices: Boolean(org?.settings?.architectsSeePrices) })
export { sheetOf }
