import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { findSurveyedDistance } from '@rackium/shared/pathway.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin } from './helpers/app.js'
import { surveyProject, roomWithRack, newId } from './helpers/survey.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
  await seedPlatformCatalogue()
})

const t = () => createTestApp()

describe('site structure (brief v2.3 §5.2)', () => {
  it('a Field Engineer builds floors, rooms (generated codes) and racks within scope; outside scope is not found', async () => {
    const p = await surveyProject(t())
    const b001 = p.building('B001').id
    const { floor, room, rack } = await roomWithRack(p.feB001, p.base, b001)
    expect(room.code).toBe('TR-EG-01')
    expect(rack).toMatchObject({ code: 'R01', heightU: 42 })
    const second = (await p.feB001.post(`${p.base}/survey/rooms`).send({ floorId: floor.id }).expect(201)).body.room
    expect(second.code).toBe('TR-EG-02')

    // The scoped Field Engineer cannot see or change B002.
    await p.feB001.get(`${p.base}/survey/buildings/${p.building('B002').id}/structure`).expect(404)
    await p.feB001.post(`${p.base}/survey/floors`).send({ buildingId: p.building('B002').id, token: 'EG', name: 'EG', order: 0 }).expect(404)
    // Viewers and Reviewers do not edit the structure.
    await p.viewer.post(`${p.base}/survey/rooms`).send({ floorId: floor.id }).expect(403)

    const tree = (await p.feB001.get(`${p.base}/survey/buildings/${b001}/structure`).expect(200)).body
    expect(tree.buildings[0].floors[0].rooms.map((r) => r.code)).toEqual(['TR-EG-01', 'TR-EG-02'])
    expect(tree.buildings[0].floors[0].rooms[0].racks).toEqual([expect.objectContaining({ code: 'R01', heightU: 42 })])
    // Shared validation: a room without a rack, and rooms without captured details.
    expect(tree.findings.map((f) => f.type)).toEqual(expect.arrayContaining(['room-without-rack', 'rack-without-room-details']))
  })

  it('room survey facts are captured and clear the "no room details" finding', async () => {
    const p = await surveyProject(t())
    const b001 = p.building('B001').id
    const { room } = await roomWithRack(p.fe, p.base, b001)
    const res = await p.fe.patch(`${p.base}/survey/rooms/${room.id}/survey`).send({ access: 'verified', power: 'available' }).expect(200)
    expect(res.body.room.survey).toEqual({ access: 'verified', power: 'available', environment: 'unknown', captured: true })
    const tree = (await p.fe.get(`${p.base}/survey/buildings/${b001}/structure`)).body
    expect(tree.findings.filter((f) => f.type === 'rack-without-room-details')).toHaveLength(0)
    await p.fe.patch(`${p.base}/survey/rooms/${room.id}/survey`).send({ access: 'maybe' }).expect(400)
  })

  it('rack heights must be allowed heights of the organisation', async () => {
    const p = await surveyProject(t())
    const { room } = await roomWithRack(p.fe, p.base, p.building('B001').id)
    await p.fe.post(`${p.base}/survey/racks`).send({ roomId: room.id, heightU: 23 }).expect(400)
    await p.fe.post(`${p.base}/survey/racks`).send({ roomId: room.id, heightU: 24 }).expect(201)
  })
})

describe('pathways', () => {
  it('connect rooms across buildings, once per pair, and feed the shared cable-length engine', async () => {
    const p = await surveyProject(t())
    const a = await roomWithRack(p.fe, p.base, p.building('B001').id)
    const b = await roomWithRack(p.fe, p.base, p.building('B002').id)
    const created = (await p.fe.post(`${p.base}/survey/pathways`).send({ fromRoomId: a.room.id, toRoomId: b.room.id }).expect(201)).body.pathway
    expect(created).toMatchObject({ routeStatus: 'estimated', distanceM: null })
    // Same pair, drawn the other way round.
    await p.fe.post(`${p.base}/survey/pathways`).send({ fromRoomId: b.room.id, toRoomId: a.room.id }).expect(409)
    await p.fe.patch(`${p.base}/survey/pathways/${created.id}`).send({ routeStatus: 'surveyed', distanceM: 68 }).expect(200)

    const { pathways } = (await p.fe.get(`${p.base}/survey/pathways`).expect(200)).body
    expect(findSurveyedDistance(a.room.id, b.room.id, pathways)).toBe(68)
    expect(findSurveyedDistance(b.room.id, a.room.id, pathways)).toBe(68)

    // Both buildings' structure shows the route; a Field Engineer scoped to
    // one building cannot change a route that reaches outside it.
    const tree = (await p.fe.get(`${p.base}/survey/buildings/${p.building('B002').id}/structure`)).body
    expect(tree.pathways).toEqual([expect.objectContaining({ id: created.id, distanceM: 68, routeStatus: 'surveyed' })])
    await p.feB001.patch(`${p.base}/survey/pathways/${created.id}`).send({ distanceM: 1 }).expect(404)
    // A room on a route cannot be deleted.
    await p.admin.agent.delete(`${p.base}/hierarchy/rooms/${a.room.id}`).expect(409)
  })
})

describe('rack survey', () => {
  async function rackSetup() {
    const p = await surveyProject(t())
    const b001 = p.building('B001').id
    const { room, rack } = await roomWithRack(p.fe, p.base, b001)
    // One CMO device for B001 to pick from.
    await p.admin.agent
      .post(`${p.base}/cmo/import`)
      .send({ salId: p.sal('ERL').id, rows: [{ rowIndex: 0, hostname: 'SW-OLD-01', model: 'C9300-48UX', serial: 'CMO-001', mac: null, building: 'B001', floor: null, room: null, rack: null, ru: null }] })
      .expect(201)
    const rackPath = `${p.base}/survey/racks/${rack.id}`
    const survey = (await p.fe.get(rackPath).expect(200)).body
    return { p, room, rack, rackPath, cmoDevice: survey.roomCmoList[0] }
  }
  const switch1U = (fields) => ({ ru: 40, heightU: 1, face: 'front', label: '24-port switch', category: 'Switches', ...fields })

  it('places a CMO device, an entered device and a library item; readiness is calculated', async () => {
    const { p, rackPath, cmoDevice } = await rackSetup()
    expect(cmoDevice).toMatchObject({ serial: 'CMO-001', expectedHostname: 'SW-OLD-01', placedInRackId: null })
    const saved = (
      await p.fe
        .patch(`${rackPath}/placements`)
        .send({
          placements: [
            switch1U({ deviceId: cmoDevice.deviceId, ru: 40, label: 'SW-OLD-01', serial: 'CMO-001' }),
            switch1U({ ru: 38, heightU: 2, label: 'Firewall', category: 'Security', serial: 'NEW-002', mac: '00-11-22-33-44-55' }),
            switch1U({ ru: 36, label: 'Cable manager', category: 'Cable management' }),
            { ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' },
          ],
        })
        .expect(200)
    ).body
    expect(saved.placements.filter((x) => x.kind === 'device')).toHaveLength(4)
    expect(saved.placements.find((x) => x.label === 'Firewall')).toMatchObject({ ru: 38, heightU: 2, serial: 'NEW-002', mac: '00:11:22:33:44:55' })
    expect(saved.freeRu.front).toEqual({ availableRU: 38, contiguousFreeRU: 35 })
    expect(saved.readiness.checks.find((c) => c.id === 'cable').pass).toBe(true)
    expect(saved.roomCmoList[0].placedInRackId).toBe(saved.rack.id)
  })

  it('refuses overlaps per face, full-depth clashes, out-of-boundary and duplicate serials', async () => {
    const { p, rackPath } = await rackSetup()
    const overlap = await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({}), switch1U({ label: 'Second', ru: 40 })] }).expect(400)
    expect(overlap.body.error.message).toMatch(/Conflicts with/)
    // Different faces at the same RU are fine; a full-depth item takes both.
    await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({}), switch1U({ label: 'Rear', face: 'rear' })] }).expect(200)
    await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({}), switch1U({ label: 'Deep', face: 'rear', fullDepth: true })] }).expect(400)
    const boundary = await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({ ru: 42, heightU: 2 })] }).expect(400)
    expect(boundary.body.error.message).toMatch(/boundary/)
    const dup = await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({ serial: 'cmo-001' })] }).expect(409)
    expect(dup.body.error.code).toBe('duplicate_serial')
  })

  // Regression: placing a CMO device without restating its serial used to
  // clear the serial (and its registry entry).
  it('placing a CMO device keeps its serial, and an imported serial cannot be overwritten', async () => {
    const { p, rackPath, cmoDevice } = await rackSetup()
    const saved = (await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({ deviceId: cmoDevice.deviceId, label: 'SW-OLD-01' })] }).expect(200)).body
    expect(saved.placements[0].serial).toBe('CMO-001')
    expect(saved.allProjectSerials.map((s) => s.serial)).toContain('CMO-001')
    await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({ deviceId: cmoDevice.deviceId, label: 'SW-OLD-01', serial: 'OTHER' })] }).expect(400)
  })

  // The rack screen chooses ids for newly placed items so autosave and undo
  // keep addressing the same device (temporary ids made an undone, identified
  // device collide with itself on its serial).
  it('a new item keeps the id the client chose across saves, removal and undo', async () => {
    const { p, rackPath } = await rackSetup()
    const deviceId = newId()
    const placed = switch1U({ deviceId, serial: 'NEW-100' })
    const first = (await p.fe.patch(`${rackPath}/placements`).send({ placements: [placed] }).expect(200)).body
    expect(first.placements).toEqual([expect.objectContaining({ id: deviceId, deviceId, serial: 'NEW-100' })])
    await p.fe.patch(`${rackPath}/placements`).send({ placements: [{ ...placed, ru: 30 }] }).expect(200)
    // Removed (identified, so only unplaced), then brought back by undo.
    await p.fe.patch(`${rackPath}/placements`).send({ placements: [] }).expect(200)
    const back = (await p.fe.patch(`${rackPath}/placements`).send({ placements: [placed] }).expect(200)).body
    expect(back.placements).toEqual([expect.objectContaining({ id: deviceId, ru: 40, serial: 'NEW-100' })])
    // Another building's device cannot be pulled in by id.
    const other = await roomWithRack(p.fe, p.base, p.building('B002').id)
    await p.fe.patch(`${p.base}/survey/racks/${other.rack.id}/placements`).send({ placements: [switch1U({ deviceId })] }).expect(400)
  })

  it('reserved RU is the Architect’s, blocked RU the PM’s or Org Admin’s; devices cannot go over either', async () => {
    const { p, rackPath } = await rackSetup()
    await p.fe.post(`${rackPath}/ru-states`).send({ ru: 30, face: 'front', state: 'reserved' }).expect(403)
    await p.admin.agent.post(`${rackPath}/ru-states`).send({ ru: 30, face: 'front', state: 'reserved' }).expect(403) // Org Admin + PM, not Architect
    const reserved = (await p.architect.post(`${rackPath}/ru-states`).send({ ru: 30, face: 'front', state: 'reserved', reason: 'Reserved for FMO' }).expect(201)).body.ruState
    await p.architect.post(`${rackPath}/ru-states`).send({ ru: 20, face: 'front', state: 'blocked' }).expect(403)
    const blocked = (await p.admin.agent.post(`${rackPath}/ru-states`).send({ ru: 20, face: 'front', state: 'blocked' }).expect(201)).body.ruState

    // A block applies to both faces; a reservation only to its own.
    await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({ ru: 20, face: 'rear' })] }).expect(400)
    await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({ ru: 30 })] }).expect(400)
    await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({ ru: 30, face: 'rear' })] }).expect(200)
    // And an RU cannot be reserved over a device.
    await p.architect.post(`${rackPath}/ru-states`).send({ ru: 30, face: 'rear', state: 'reserved' }).expect(409)

    // The Architect cannot release (override) a block.
    await p.architect.delete(`${rackPath}/ru-states/${blocked.ruStateId}`).expect(403)
    await p.admin.agent.delete(`${rackPath}/ru-states/${blocked.ruStateId}`).expect(200)
    await p.architect.delete(`${rackPath}/ru-states/${reserved.ruStateId}`).expect(200)
  })

  it('taking gear out unplaces identified devices and removes anonymous items; Save version bumps the revision', async () => {
    const { p, rackPath, cmoDevice } = await rackSetup()
    await p.fe.patch(`${rackPath}/placements`).send({ placements: [switch1U({ deviceId: cmoDevice.deviceId, label: 'SW-OLD-01' }), switch1U({ ru: 30, label: 'Shelf', category: 'Accessories' })] }).expect(200)
    const after = (await p.fe.patch(`${rackPath}/placements`).send({ placements: [] }).expect(200)).body
    expect(after.placements).toHaveLength(0)
    expect(after.roomCmoList[0]).toMatchObject({ serial: 'CMO-001', placedInRackId: null })
    expect((await p.fe.post(`${rackPath}/versions`).expect(201)).body.revision).toBe(1)
    expect((await p.fe.post(`${rackPath}/versions`).expect(201)).body.revision).toBe(2)
  })

  it('only the Field Engineer places gear; facts are edited by structure editors and feed readiness', async () => {
    const { p, rackPath } = await rackSetup()
    await p.architect.patch(`${rackPath}/placements`).send({ placements: [] }).expect(403)
    await p.viewer.patch(`${rackPath}/facts`).send({ details: { usableDepthMm: 800 } }).expect(403)
    const before = (await p.fe.get(rackPath)).body.readiness.checks.find((c) => c.id === 'depth')
    expect(before.pass).toBe(false)
    await p.fe.patch(`${rackPath}/facts`).send({ details: { usableDepthMm: 800 }, mountingPower: { pduA: { totalSockets: 8, freeSockets: 3 } } }).expect(200)
    const checks = (await p.fe.get(rackPath)).body.readiness.checks
    expect(checks.find((c) => c.id === 'depth').pass).toBe(true)
    expect(checks.find((c) => c.id === 'power').pass).toBe(true)
  })

  it('another organisation and a scoped Field Engineer elsewhere cannot reach the rack', async () => {
    const ctx = t()
    const p = await surveyProject(ctx)
    const { rack } = await roomWithRack(p.fe, p.base, p.building('B002').id)
    await p.feB001.get(`${p.base}/survey/racks/${rack.id}`).expect(404)
    const outsider = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    await outsider.agent.get(`${p.base}/survey/racks/${rack.id}`).expect(404)
  })
})
