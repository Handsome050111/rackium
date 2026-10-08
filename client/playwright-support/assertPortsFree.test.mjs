import net from 'node:net'
import { describe, it, expect, afterEach } from 'vitest'
import { assertPortsFree, findBusyPorts } from './assertPortsFree.mjs'

function listen(host) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, host, () => resolve(server))
  })
}

describe('assertPortsFree', () => {
  const servers = []
  afterEach(() => Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))))

  // The 2026-10-08 incident: a stale `vite preview` on [::1]:5173 was silently
  // reused by Playwright, so the run tested an old build.
  it.each(['127.0.0.1', '::1'])('rejects, naming the port, when something listens on %s', async (host) => {
    const server = await listen(host)
    servers.push(server)
    const { port } = server.address()
    await expect(assertPortsFree([port])).rejects.toThrow(new RegExp(`already in use: ${port}\\.`))
    await expect(assertPortsFree([port])).rejects.toThrow(/stale build/)
  })

  it('resolves when the port is free', async () => {
    const server = await listen('127.0.0.1')
    const { port } = server.address()
    await new Promise((r) => server.close(r))
    await expect(assertPortsFree([port])).resolves.toBeUndefined()
    expect(await findBusyPorts([port])).toEqual([])
  })
})
