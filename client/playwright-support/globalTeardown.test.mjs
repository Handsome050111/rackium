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

  // Regression: the teardown returned once the HTTP port closed, while the
  // process was still removing its database — Playwright then killed it
  // half-way and the folder stayed. It now waits for the process itself.
  it('waits for the server process to exit, not only for its port to close', async () => {
    const server = await listen((req, res) => {
      res.end(JSON.stringify({ stopping: true, pid: 4242 }), () => {
        server.closeAllConnections()
        server.close()
      })
    })
    const base = `http://127.0.0.1:${server.address().port}`
    let checks = 0
    const isAlive = (pid) => {
      expect(pid).toBe(4242)
      checks += 1
      return checks < 4
    }
    expect(await stopE2eServer({ base, timeoutMs: 5000, isAlive })).toBe('stopped')
    expect(checks).toBe(4)
  })

  it('is a no-op when no server is running', async () => {
    const server = await listen(() => {})
    const base = `http://127.0.0.1:${server.address().port}`
    await new Promise((resolve) => server.close(resolve))
    expect(await stopE2eServer({ base, timeoutMs: 1000 })).toBe('not_running')
  })
})
