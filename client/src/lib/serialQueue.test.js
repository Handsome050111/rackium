import { describe, it, expect } from 'vitest'
import { serialQueue } from './serialQueue.js'

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('serialQueue', () => {
  // Regression (M4b): a second LLD write clicked while the first was still
  // reloading went out with the old revision, was refused as stale, and the
  // first write's reload then wiped the message — the click was lost.
  it('runs each task after the previous one has finished, in order', async () => {
    const run = serialQueue()
    const log = []
    let revision = 11
    const first = run(async () => {
      log.push(`start first @${revision}`)
      await tick()
      revision = 12
      log.push('end first')
    })
    const second = run(async () => log.push(`start second @${revision}`))
    await Promise.all([first, second])
    expect(log).toEqual(['start first @11', 'end first', 'start second @12'])
  })

  it('a failed task rejects for its caller but does not stop the queue', async () => {
    const run = serialQueue()
    await expect(run(async () => Promise.reject(new Error('stale')))).rejects.toThrow('stale')
    expect(await run(async () => 'next')).toBe('next')
  })
})
