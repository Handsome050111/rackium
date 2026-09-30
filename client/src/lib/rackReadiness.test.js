import { describe, it, expect } from 'vitest'
import { computeReadiness } from './rackReadiness.js'

const goodMeta = {
  details: { usableDepthMm: 850 },
  mountingPower: { availableCageNutSets: 10, pduA: { freeSockets: 12 }, pduB: { freeSockets: 10 } },
  cablePath: { verticalManagers: 2, horizontalManagers: 1 },
}

describe('computeReadiness', () => {
  it('is fully Ready when every check passes', () => {
    const result = computeReadiness({ placements: [], rackHeightU: 42, meta: goodMeta })
    expect(result.overallStatus).toBe('Ready')
    expect(result.actions).toHaveLength(0)
  })

  it('fails power readiness when a PDU has no free sockets', () => {
    const meta = { ...goodMeta, mountingPower: { ...goodMeta.mountingPower, pduA: { freeSockets: 0 } } }
    const result = computeReadiness({ placements: [], rackHeightU: 42, meta })
    expect(result.checks.find((c) => c.id === 'power').pass).toBe(false)
    expect(result.overallStatus).toBe('Ready with 1 action')
  })

  it('fails mounting material when placed devices exceed available cage nut sets', () => {
    const meta = { ...goodMeta, mountingPower: { ...goodMeta.mountingPower, availableCageNutSets: 1 } }
    const placements = [
      { id: 'a', mounting: 'rack', kind: 'device' },
      { id: 'b', mounting: 'rack', kind: 'device' },
    ]
    const result = computeReadiness({ placements, rackHeightU: 42, meta })
    expect(result.checks.find((c) => c.id === 'mounting').pass).toBe(false)
  })

  it('cable management passes from an actually-placed cable manager even with no meta managers', () => {
    const meta = { ...goodMeta, cablePath: { verticalManagers: 0, horizontalManagers: 0 } }
    const placements = [{ id: 'cm', category: 'Cable management', mounting: 'rack', kind: 'device' }]
    const result = computeReadiness({ placements, rackHeightU: 42, meta })
    expect(result.checks.find((c) => c.id === 'cable').pass).toBe(true)
  })

  it('reports available and contiguous free RU from the front face', () => {
    const placements = [{ id: 'a', ru: 20, heightU: 1, face: 'front', kind: 'device', mounting: 'rack' }]
    const result = computeReadiness({ placements, rackHeightU: 23, meta: goodMeta })
    expect(result.availableRU).toBe(22)
  })
})
