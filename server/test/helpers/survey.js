import crypto from 'node:crypto'
import mongoose from 'mongoose'
import sharp from 'sharp'
import { SURVEY_TABS, isCalculatedKey } from '@rackium/shared/surveyForm.js'
import { signedInOrgAdmin, projectMember } from './app.js'

export const api = (orgId, projectId) => `/api/v1/orgs/${orgId}/projects/${projectId}`
export const newId = () => new mongoose.Types.ObjectId().toString()

const HIERARCHY = [
  { countryCode: 'DE', countryName: 'Germany', salCode: 'ERL', campusCode: 'C01', buildingCode: 'B001', buildingName: 'Building B001', wingCode: '', wingName: '' },
  { countryCode: 'DE', countryName: 'Germany', salCode: 'ERL', campusCode: 'C01', buildingCode: 'B002', buildingName: 'Building B002', wingCode: '', wingName: '' },
  { countryCode: 'DE', countryName: 'Germany', salCode: 'MUC', campusCode: 'C02', buildingCode: 'B101', buildingName: 'Building B101', wingCode: '', wingName: '' },
]

// A project (CMO and Survey active) with B001, B002 (SAL ERL) and B101 (SAL
// MUC), and the team: the Org Admin (also PM, as creator), an Architect, a
// Field Engineer for the whole project, a Field Engineer scoped to B001, and
// a Viewer.
export async function surveyProject(ctx) {
  const admin = await signedInOrgAdmin(ctx)
  const created = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'Survey', code: 'SRV' }).expect(201)
  const projectId = created.body.project.id
  const base = api(admin.orgId, projectId)
  await admin.agent.patch(base).send({ activePhaseKeys: ['cmo', 'survey'] }).expect(200)
  await admin.agent.post(`${base}/hierarchy/import`).send({ rows: HIERARCHY }).expect(201)
  const cmo = (await admin.agent.get(`${base}/cmo`).expect(200)).body
  const building = (code) => cmo.buildings.find((b) => b.code === code)
  const sal = (code) => cmo.sals.find((s) => s.code === code)
  const member = (email, role, scopes) => projectMember(ctx, admin, { email, role, projectId, scopes })
  const team = {
    architect: await member('architect@example.com', 'architect'),
    fe: await member('fe@example.com', 'field_engineer'),
    feB001: await member('fe-b001@example.com', 'field_engineer', [{ type: 'building', refId: building('B001').id }]),
    viewer: await member('viewer@example.com', 'viewer'),
  }
  return { admin, projectId, base, building, sal, ...team }
}

// Floor EG with one room and one 42U rack in a building, created by `agent`.
export async function roomWithRack(agent, base, buildingId, { token = 'EG', order = 0 } = {}) {
  const floor = (await agent.post(`${base}/survey/floors`).send({ buildingId, token, name: `Floor ${token}`, order }).expect(201)).body.floor
  const room = (await agent.post(`${base}/survey/rooms`).send({ floorId: floor.id }).expect(201)).body.room
  const rack = (await agent.post(`${base}/survey/racks`).send({ roomId: room.id }).expect(201)).body.rack
  return { floor, room, rack }
}

export async function jpeg({ width = 640, height = 480, color = '#094F9A' } = {}) {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer()
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// Uploads `bytes` in chunks and completes it; returns the file view.
export async function upload(agent, base, { attachedTo, bytes, category = 'photo_reference', fileName = 'photo.jpg', mimeType = 'image/jpeg', chunkSize = 64 * 1024 }) {
  const fileId = newId()
  await agent.post(`${base}/files/uploads`).send({ fileId, fileName, mimeType, sizeBytes: bytes.length, sha256: sha256(bytes), category, attachedTo }).expect(201)
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    await agent.patch(`${base}/files/uploads/${fileId}?offset=${offset}`).set('Content-Type', 'application/octet-stream').send(bytes.subarray(offset, offset + chunkSize)).expect(200)
  }
  return (await agent.post(`${base}/files/uploads/${fileId}/complete`).expect(201)).body.file
}

const valueFor = (field, photoId) => {
  if (field.type === 'photo' || field.type === 'photo_multi' || field.type === 'file') return { fileIds: [photoId] }
  if (field.type === 'number' || field.type === 'number_m') return 1
  if (field.type === 'yes_no') return 'Yes'
  if (field.type === 'email') return 'site@example.com'
  if (field.type === 'ip') return '10.0.0.1'
  if (field.type === 'mac') return '00:11:22:33:44:55'
  return 'Filled'
}

// Fills every "must" field a tab needs to be submittable (tables stay
// empty — an empty table is complete), as the Field Engineer, through the
// sync endpoint. Uploads one photo to the record for photo cells.
export async function fillTab(fe, base, { buildingId, roomId = null, tab }) {
  const tabDef = SURVEY_TABS.find((t) => t.tab === tab)
  const target = { buildingId, roomId, tab }
  const needsPhoto = tabDef.sections.some((s) => s.fields.some((f) => /photo|file/.test(f.type) && ['must', 'must_if_allowed'].includes(f.requirement)) || s.item_columns?.includes('photograph'))
  const photo = needsPhoto ? await upload(fe, base, { attachedTo: { type: 'surveyTab', ...target }, bytes: await jpeg({ width: 32, height: 24 }) }) : null
  const edits = []
  const push = (op) => edits.push({ opId: `fill-${newId()}`, queuedAt: new Date(Date.now() + edits.length).toISOString(), ...target, op, baseLastModifiedAt: null })
  const hasRackInstances = tabDef.sections.some((s) => s.repeatable_per === 'rack')
  const record = hasRackInstances ? (await fe.get(`${base}/survey/records`).query({ buildingId, roomId, tab }).expect(200)).body.record : null
  tabDef.sections.forEach((section, sectionIndex) => {
    const must = section.fields.filter((f) => ['must', 'must_if_allowed'].includes(f.requirement))
    if (section.repeatable_per === 'rack') {
      for (const instance of record.sections[sectionIndex]) {
        for (const f of must) {
          if (f.type === 'rack_elevation' || isCalculatedKey(tabDef, section, f.key)) continue
          push({ kind: 'setField', sectionIndex, rackId: instance.rackId, key: f.key, value: valueFor(f, photo?.id) })
        }
      }
    } else if (section.layout === 'key_value') {
      for (const f of must) {
        if (f.type === 'rack_elevation') continue
        push({ kind: 'setField', sectionIndex, key: f.key, value: valueFor(f, photo?.id) })
        if (f.prefill === 'prefilled_validated') push({ kind: 'confirmField', sectionIndex, key: f.key, confirmed: true })
      }
    }
    if (section.layout === 'item_list') {
      for (const f of must) for (const col of section.item_columns) push({ kind: 'setField', sectionIndex, rowKey: f.key, key: col, value: col === 'photograph' ? { fileIds: [photo.id] } : 'Filled' })
    }
  })
  if (edits.length) await fe.post(`${base}/survey/sync`).send({ edits }).expect(200)
}

export function transition(agent, base, target, action, reason = '') {
  return agent.post(`${base}/survey/records/transitions`).send({ ...target, action, reason })
}
