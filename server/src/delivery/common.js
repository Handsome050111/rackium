import mongoose from 'mongoose'
import crypto from 'node:crypto'
import { cageNutsOf, buildBom } from '@rackium/shared/bomCalc.js'
import { RESOURCE_TASKS, buildResourceEstimate } from '@rackium/shared/billOfResources.js'
import { ProjectSettings } from '../models/projectSettings.js'
import { Organisation } from '../models/organisation.js'
import { Country } from '../models/country.js'
import { DesignVersion } from '../models/designVersion.js'
import { File } from '../models/file.js'
import { User } from '../models/user.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { projectCatalogue } from '../catalogue/service.js'

export const id = (v) => (v ? String(v) : null)
export const oid = (v) => new mongoose.Types.ObjectId(String(v))

export async function namesOf(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))]
  if (!list.length) return new Map()
  return new Map((await User.find({ _id: { $in: list } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u.name || u.email]))
}

// The project's commercial and resource standards (DATA-MODEL §3.9 subset).
export async function projectSettings(session = null) {
  const doc = await ProjectSettings.findOne({}).session(session).lean()
  const minutes = Object.fromEntries(RESOURCE_TASKS.map((t) => [t.id, t.defaultMinutes]))
  const stored = doc?.resourceMinutes instanceof Map ? Object.fromEntries(doc.resourceMinutes) : doc?.resourceMinutes ?? {}
  return {
    marginPercent: doc?.marginPercent ?? 15,
    resourceMinutes: { ...minutes, ...stored },
    powerCordStandard: doc?.powerCordStandard?.connectorPair ? doc.powerCordStandard : null,
  }
}

export async function organisationCommercial(session = null) {
  const org = await Organisation.findById(currentScope().organisationId, { defaultCurrency: 1, 'settings.cordLengthDefaultM': 1, 'settings.architectsSeePrices': 1, 'settings.cageNutsPerRu': 1 }).session(session).lean()
  return { currency: org?.defaultCurrency ?? 'EUR', cordLengthM: org?.settings?.cordLengthDefaultM ?? 2, architectsSeePrices: Boolean(org?.settings?.architectsSeePrices), cageNutsPerRu: cageNutsOf(org) }
}

export async function countryCodeOf(building, session = null) {
  if (!building.countryId) return null
  return (await Country.findById(building.countryId, { code: 1 }).session(session).lean())?.code ?? null
}

// The BOM of a building's design (or of a branch — a change request's), with
// the inputs it was calculated from.
export async function computeBom(lld, req, building, { branchId = null, session = null } = {}) {
  const design = await lld.designData(req, building.id, { branchId, session })
  // The catalogue with prices (design data carries it without).
  const [settings, org, countryCode, catalogue] = await Promise.all([projectSettings(session), organisationCommercial(session), countryCodeOf(building, session), projectCatalogue(currentScope().projectId, { showPrices: true })])
  const bom = buildBom(
    { devices: design.devices, connections: design.connections },
    {
      stage: design.stage,
      racks: design.racks,
      catalogue,
      cageNutsPerRu: org.cageNutsPerRu,
      power: { customerStandard: settings.powerCordStandard, countryCode, cordLengthM: org.cordLengthM },
      currency: org.currency,
    }
  )
  return { bom, design, settings, org }
}

// Bill of Resources from the design (brief §5.5): tasks × PM-set minutes.
export function resourceEstimateOf(design, minutes) {
  const roomOfDevice = new Map(design.devices.map((d) => [d.id, d.roomCode]))
  const passive = (d) => d.isPanel || ['patch_panel', 'cable_management', 'accessory'].includes(d.category)
  return buildResourceEstimate(
    {
      devices: design.devices.map((d) => ({ role: d.role, roomCode: d.roomCode, passive: passive(d), notProcured: ['wan_sp_connection', 'remote_site'].includes(d.category) || d.role === 'wan_circuit' || d.role === 'remote_site' })),
      rows: design.connections.map((c) => ({ media: c.media, dest: { entity: { roomCode: roomOfDevice.get(c.dest.deviceId) ?? roomOfDevice.get(c.source.deviceId) ?? null } } })),
      racks: design.racks.map((r) => ({ roomCode: r.roomCode })),
    },
    minutes
  )
}

// A numbered, JSON-snapshotted design version (solution_package, bom) — the
// same storage pattern as HLD/LLD versions (DATA-MODEL §5.6).
export async function writeSnapshotVersion({ storage, building, designType, label, payload, actor, frozen = false, counts = {}, basedOnVersionId = null, session }) {
  const { projectId } = currentScope()
  const versionId = new mongoose.Types.ObjectId()
  const fileId = new mongoose.Types.ObjectId()
  const last = await DesignVersion.findOne({ buildingId: building.id, designType }).sort({ number: -1 }).session(session).lean()
  const number = (last?.number ?? 0) + 1
  const bytes = Buffer.from(JSON.stringify({ designType, building: { id: building.id, code: building.code }, label, number, ...payload, createdAt: new Date().toISOString() }, null, 2))
  const storageKey = `files/${projectId}/${fileId}`
  await storage.put(storageKey, bytes)
  try {
    await File.create([{ _id: fileId, buildingId: building.id, attachedTo: { type: 'designVersion', id: versionId }, category: 'data_snapshot', fileName: `${designType.toUpperCase()}-${building.code}-v${number}.json`, storageKey, mimeType: 'application/json', sizeBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), uploadedBy: actor.userId }], { session })
    await DesignVersion.create([{ _id: versionId, buildingId: building.id, designType, number, label, basedOnVersionId, snapshotFileId: fileId, counts, frozen, frozenAt: frozen ? new Date() : null, createdBy: actor.userId }], { session })
  } catch (err) {
    await storage.remove(storageKey).catch(() => {})
    throw err
  }
  return { versionId, number }
}

export async function readSnapshot(storage, fileId, session = null) {
  const file = await File.findById(fileId).session(session).lean()
  if (!file) return null
  return JSON.parse((await storage.read(file.storageKey)).toString('utf8'))
}
