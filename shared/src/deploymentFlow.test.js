import { describe, it, expect } from 'vitest'
import { applyDeploymentStyling } from './deploymentFlow.js'

const flow = {
  nodes: [
    { id: 'n1', type: 'device', data: { deviceId: 'd1' } },
    { id: 'band', type: 'floorBand', data: {} },
  ],
  edges: [{ id: 'c1' }, { id: 'c2' }],
}

describe('applyDeploymentStyling', () => {
  it('attaches the Pending/Installed/Ready label to device nodes, leaves other node types alone', () => {
    const result = applyDeploymentStyling(flow, [{ id: 'd1', status: 'tested' }], [])
    expect(result.nodes.find((n) => n.id === 'n1').data.deploymentLabel).toBe('Ready')
    expect(result.nodes.find((n) => n.id === 'band').data.deploymentLabel).toBeUndefined()
  })

  it('leaves a live connection\'s styling untouched (keeps the real media colour)', () => {
    const result = applyDeploymentStyling(flow, [], [{ id: 'c1', status: 'installed' }, { id: 'c2', status: 'designed' }])
    expect(result.edges.find((e) => e.id === 'c1').style).toBeUndefined()
  })

  it('greys out and dashes a planned (not-yet-live) connection', () => {
    const result = applyDeploymentStyling(flow, [], [{ id: 'c1', status: 'installed' }, { id: 'c2', status: 'designed' }])
    const planned = result.edges.find((e) => e.id === 'c2')
    expect(planned.style.strokeDasharray).toBe('6 4')
    expect(planned.style.stroke).toBe('#C7CCD6')
  })
})
