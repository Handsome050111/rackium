import { describe, it, expect } from 'vitest'
import { resolveQueuedEdit } from './offlineQueue.js'

describe('resolveQueuedEdit', () => {
  it('applies cleanly when the record was not touched while this device was offline', () => {
    const entry = { baseModifiedAt: '2026-10-01T10:00:00Z' }
    expect(resolveQueuedEdit(entry, '2026-10-01T10:00:00Z').outcome).toBe('applied')
    expect(resolveQueuedEdit(entry, null).outcome).toBe('applied')
  })

  it('is a conflict when the live record changed after this edit was queued — last save wins, but it is reported', () => {
    const entry = { baseModifiedAt: '2026-10-01T10:00:00Z' }
    const result = resolveQueuedEdit(entry, '2026-10-01T10:05:00Z')
    expect(result.outcome).toBe('conflict')
    expect(result.currentModifiedAt).toBe('2026-10-01T10:05:00Z')
  })

  it('is not a conflict when the live record changed before this edit was queued', () => {
    const entry = { baseModifiedAt: '2026-10-01T10:05:00Z' }
    expect(resolveQueuedEdit(entry, '2026-10-01T10:00:00Z').outcome).toBe('applied')
  })

  it('a record this device never saw edited before (baseModifiedAt null) still conflicts if anyone touched it while offline', () => {
    const entry = { baseModifiedAt: null }
    expect(resolveQueuedEdit(entry, '2026-10-01T10:00:00Z').outcome).toBe('conflict')
  })

  it('applies cleanly when neither side has ever touched the record', () => {
    expect(resolveQueuedEdit({ baseModifiedAt: null }, null).outcome).toBe('applied')
  })
})
