// Ports of a CMDB device with what each is patched to (as-built).
export function portRows(record, connections) {
  const rows = new Map((record.ports ?? []).map((p) => [p.id, { port: p.id, type: p.type, conn: null }]))
  for (const c of connections) {
    for (const [end, other] of [
      ['source', 'dest'],
      ['dest', 'source'],
    ]) {
      if (c[end].deviceId !== record.id) continue
      const port = c[end].portId ?? '—'
      rows.set(port, { port, type: rows.get(port)?.type ?? null, conn: c, other: c[other], hops: end === 'source' ? c.hops : [...c.hops].reverse() })
    }
  }
  return [...rows.values()].sort((a, b) => Boolean(b.conn) - Boolean(a.conn) || String(a.port).localeCompare(String(b.port), undefined, { numeric: true }))
}
