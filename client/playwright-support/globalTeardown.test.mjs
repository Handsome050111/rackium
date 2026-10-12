import http from 'node:http'
import { describe, it, expect } from 'vitest'
import { stopE2eServer } from './globalTeardown.mjs'

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

// Regression: Playwright force-kills the e2e server on Windows, so its
// in-memory database folder was never removed. The teardown now asks it to
// stop itself and waits until it has.
describe('stopE2eServer', () => {
  it('asks the server to shut down and waits until it has gone', async () => {
    const calls = []
    const server = await listen((req, res) => {
      calls.push(`${req.method} ${req.url}`)
      if (req.url === '/__e2e/shutdown') {
        res.end('{}', () => setTimeout(() => {
          server.closeAllConnections()
          server.close()
        }, 300))
        return
      }
      res.end('{}')
    })
    const base = `http://127.0.0.1:${server.address().port}`
    expect(await stopE2eServer({ base, timeoutMs: 5000 })).toBe('stopped')
    expect(calls[0]).toBe('POST /__e2e/shutdown')
  })

  it('is a no-op when no server is running', async () => {
    const server = await listen(() => {})
    const base = `http://127.0.0.1:${server.address().port}`
    await new Promise((resolve) => server.close(resolve))
    expect(await stopE2eServer({ base, timeoutMs: 1000 })).toBe('not_running')
  })
})
