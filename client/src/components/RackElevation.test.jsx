// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import RackElevation from './RackElevation.jsx'

// A wide screen: both faces side by side unless the elevation is compact.
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const rack = { id: 'k', code: 'R01', heightU: 12 }
const placements = [
  { id: 'sw', ru: 10, heightU: 1, face: 'front', mounting: 'rack', kind: 'device', label: 'E-1' },
  { id: 'pdu', ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', kind: 'device', label: 'PDU-A' },
]
const draw = (props = {}) =>
  render(
    <DndContext>
      <RackElevation rack={rack} placements={placements} mode="view" {...props} />
    </DndContext>
  )

describe('RackElevation', () => {
  // Regression: blocks started at the face's left edge and covered the RU
  // numbers ("P42R01-01").
  it('draws blocks clear of the RU-number column', () => {
    draw()
    expect(screen.getByTitle('E-1').style.left).toBe('30px')
  })

  it('shows both faces on a wide screen; compact shows one face with a toggle', () => {
    draw()
    expect(screen.getAllByText(/^(front|rear)$/i).length).toBe(2)
    expect(screen.getByTitle('PDU-A')).toBeTruthy() // the rear rail
    cleanup()
    draw({ compact: true })
    expect(screen.getByRole('button', { name: 'rear' })).toBeTruthy()
    expect(screen.queryByTitle('PDU-A')).toBeNull() // front face shown first
  })
})
