import net from 'node:net'

// True if anything accepts a TCP connection on localhost:port. Probes both
// loopback families: `vite preview` binds [::1] on this machine, so a
// bind-test on 127.0.0.1 alone would wrongly report the port as free.
function isListening(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (inUse) => {
      socket.destroy()
      resolve(inUse)
    }
    socket.setTimeout(1000, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

export async function findBusyPorts(ports) {
  const busy = []
  for (const port of ports) {
    const results = await Promise.all([isListening(port, '127.0.0.1'), isListening(port, '::1')])
    if (results.some(Boolean)) busy.push(port)
  }
  return busy
}

export async function assertPortsFree(ports) {
  const busy = await findBusyPorts(ports)
  if (busy.length === 0) return
  throw new Error(
    [
      `Playwright test-server port(s) already in use: ${busy.join(', ')}.`,
      'Something — usually a `vite preview` or test server left over from an earlier run — is still listening there,',
      'and testing against it would test a stale build, not the current code. Stop it and re-run:',
      ...busy.map((p) => `  Windows: netstat -ano | findstr :${p}   then   taskkill /F /PID <pid>`),
      ...busy.map((p) => `  macOS/Linux: lsof -ti tcp:${p} | xargs kill`),
    ].join('\n'),
  )
}
