import { describe, it, expect } from 'vitest'
import { getHldVersion, getHldChangesSince, recordHldChange, inHldBatch } from './hldVersion.js'

describe('hldVersion', () => {
  it('bumps once per change and once per batch', async () => {
    const start = getHldVersion()
    recordHldChange('one')
    expect(getHldVersion()).toBe(start + 1)

    await inHldBatch(async () => {
      recordHldChange('a')
      recordHldChange('b')
    })
    expect(getHldVersion()).toBe(start + 2)
    expect(getHldChangesSince(start + 1)[0].summaries).toEqual(['a', 'b'])
  })

  it('does not bump for an empty batch', async () => {
    const start = getHldVersion()
    await inHldBatch(async () => {})
    expect(getHldVersion()).toBe(start)
  })
})
