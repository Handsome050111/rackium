import { describe, it, expect } from 'vitest'
import { getDevicePortMap, getPatchPanelPortMap, flattenPortMap } from './portMap.js'

describe('getDevicePortMap', () => {
  it('gives an edge switch 48 access ports plus 8 separate uplink module ports', () => {
    const map = getDevicePortMap({ role: 'edge' })
    const accessPorts = flattenPortMap({ rows: map.rows, modulePorts: [] })
    expect(accessPorts).toHaveLength(48)
    expect(map.modulePorts).toHaveLength(8)
    // no skipped/duplicated ports: 1..48 all present exactly once
    const numbers = accessPorts.map((p) => p.n).sort((a, b) => a - b)
    expect(numbers).toEqual(Array.from({ length: 48 }, (_, i) => i + 1))
  })

  it('splits access ports into an odd top row and even bottom row', () => {
    const map = getDevicePortMap({ role: 'edge' })
    const [top, bottom] = map.rows
    expect(top.every((p) => p.n % 2 === 1)).toBe(true)
    expect(bottom.every((p) => p.n % 2 === 0)).toBe(true)
  })

  it('gives a border/fusion core switch 24 ports and no module', () => {
    const map = getDevicePortMap({ role: 'border' })
    expect(flattenPortMap(map)).toHaveLength(24)
    expect(map.modulePorts).toHaveLength(0)
  })
})

describe('getPatchPanelPortMap', () => {
  it('numbers a 24-port panel 01..24 with no gaps', () => {
    const map = getPatchPanelPortMap({ ports: 24 })
    const ports = flattenPortMap(map)
    expect(ports).toHaveLength(24)
    expect(ports[0].label).toBe('01')
    expect(ports[23].label).toBe('24')
    expect(ports.map((p) => p.label)).toEqual(
      Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(2, '0'))
    )
  })
})
