// `npm run dev:local:stop` — asks a running `npm run dev:local` to stop
// (its control port, 127.0.0.1:4301). It stops the server, the client and its
// in-memory database and deletes server/dev/.runtime/.
//
// If the control port does not answer but the run's process is still alive,
// that process tree is ended — only after checking its command line is
// dev:local's (a process number can be reused by an unrelated program).
import { execFileSync } from 'node:child_process'
import { pidAlive } from '../test/helpers/testDbDirs.js'
import { DEV_PORTS, readOwner, releaseRuntimeDir } from './runtime.js'

const say = (line) => console.log(line) // eslint-disable-line no-console
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitGone(pid, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (!pidAlive(pid)) return true
    await sleep(300)
  }
  return false
}

function commandLineOf(pid) {
  try {
    if (process.platform === 'win32') {
      return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8' })
    }
    return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' })
  } catch {
    return ''
  }
}

async function main() {
  const owner = readOwner()
  try {
    const res = await fetch(`http://127.0.0.1:${DEV_PORTS.control}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) })
    const { pid } = await res.json()
    say('dev:local is stopping …')
    if (await waitGone(pid)) return say('Stopped. The demo database and its files are deleted.')
    return say(`It has not finished after a minute (process ${pid}); press Ctrl+C in its terminal.`)
  } catch {
    // Not answering: not running, or killed half-way.
  }
  if (owner && pidAlive(owner.pid)) {
    if (!/dev[\\/]+local\.mjs/.test(commandLineOf(owner.pid))) {
      releaseRuntimeDir()
      return say('dev:local is not running (its old process number now belongs to another program, left alone). Leftover files removed.')
    }
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(owner.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(owner.pid, 'SIGTERM')
    await waitGone(owner.pid)
    releaseRuntimeDir()
    return say('dev:local did not answer; its processes were ended and its files removed.')
  }
  if (owner) {
    releaseRuntimeDir()
    return say('dev:local is not running. Files left by a run that was killed were removed.')
  }
  say('dev:local is not running.')
}

main()
