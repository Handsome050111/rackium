import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'

// Storage interface (DATA-MODEL §11: "files on VPS disk, accessed through a
// storage interface so the location can change later"). Keys are built by
// the server from ids only — never from user input — and are checked to stay
// inside the root, so nothing can escape it or be guessed into a public path.
const KEY_RE = /^[a-z0-9][a-z0-9/_.-]*$/

export function createDiskStorage(rootDir) {
  const root = path.resolve(rootDir)
  const resolve = (key) => {
    if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`Invalid storage key: ${key}`)
    const full = path.resolve(root, key)
    if (!full.startsWith(root + path.sep)) throw new Error('Storage key escapes the root')
    return full
  }
  const ensureDir = (full) => fs.mkdir(path.dirname(full), { recursive: true })

  return {
    async put(key, buffer) {
      const full = resolve(key)
      await ensureDir(full)
      await fs.writeFile(full, buffer)
    },
    async append(key, buffer) {
      const full = resolve(key)
      await ensureDir(full)
      await fs.appendFile(full, buffer)
    },
    async size(key) {
      try {
        return (await fs.stat(resolve(key))).size
      } catch (err) {
        if (err.code === 'ENOENT') return null
        throw err
      }
    },
    read: (key) => fs.readFile(resolve(key)),
    stream: (key) => createReadStream(resolve(key)),
    async move(fromKey, toKey) {
      const to = resolve(toKey)
      await ensureDir(to)
      await fs.rename(resolve(fromKey), to)
    },
    async remove(key) {
      await fs.rm(resolve(key), { force: true })
    },
  }
}
