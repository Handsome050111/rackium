// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ValidationResultsTable from './ValidationResultsTable.jsx'

afterEach(cleanup)

describe('ValidationResultsTable', () => {
  it('a warning can be accepted; an accepted area shows Accepted; a Critical one is never acceptable', () => {
    const onAccept = vi.fn()
    render(
      <ValidationResultsTable
        canAccept
        onAccept={onAccept}
        areas={[
          { id: 'a', name: 'Pricing', description: '', passed: 0, total: 1, result: 'warning' },
          { id: 'b', name: 'Wireless', description: '', passed: 0, total: 1, result: 'accepted' },
          { id: 'c', name: 'Design validation', description: '', passed: 0, total: 1, result: 'critical' },
          { id: 'd', name: 'Source data', description: '', passed: 1, total: 1, result: 'passed' },
        ]}
      />
    )
    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    expect(screen.getByText('Accepted')).toBeTruthy()
    expect(screen.getByText('Critical')).toBeTruthy()
    expect(screen.getByText('Passed')).toBeTruthy()
  })
})
