// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import NexAiAnalyserPanel from './NexAiAnalyserPanel.jsx'

afterEach(cleanup)

describe('NexAI analyser panel', () => {
  // Regression: the real-mode LLD's topology has no blueprint suggestions,
  // and reading them crashed the whole Physical Connections tab.
  it('renders without blueprint suggestions and uses the approved HLD device count when given', () => {
    render(<NexAiAnalyserPanel topology={{ devices: [{ id: 'a' }, { id: 'b' }] }} lldDeviceCount={5} hldDeviceCount={4} hldChanged={false} />)
    expect(screen.getByText('4 managed devices')).toBeTruthy()
    expect(screen.getByText('5 managed devices')).toBeTruthy()
    expect(screen.getByText('Review against HLD recommended')).toBeTruthy()
  })

  it('mock mode: the HLD baseline is the topology, suggestions counted', () => {
    render(<NexAiAnalyserPanel topology={{ devices: [{ id: 'a' }], suggestions: { uplinks: [{}, {}] } }} lldDeviceCount={1} hldChanged={false} />)
    expect(screen.getAllByText('1 managed devices')).toHaveLength(2)
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('Aligned with approved HLD')).toBeTruthy()
  })
})
