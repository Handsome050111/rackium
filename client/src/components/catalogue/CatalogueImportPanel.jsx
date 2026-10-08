import { useMemo, useRef, useState } from 'react'
import { Upload, Download, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import { CATALOGUE_CSV_COLUMNS, validateCatalogueRows } from '@rackium/shared/catalogue.js'
import { catalogueApi } from '../../api/catalogueApi.js'

const EXAMPLE_ROW = {
  kind: 'device_model',
  category: 'switch',
  vendor: 'Cisco',
  model: 'C9200-24P',
  description: 'Catalyst 9200 24-port PoE+',
  heightU: '1',
  fullDepth: 'no',
  mounting: 'front',
  rackMounted: 'yes',
  powerInletType: 'C14',
  poeBudgetW: '370',
  accessPortCount: '24',
  accessPortType: 'RJ45',
  accessPortSpeed: '1G',
  accessPortPoe: 'yes',
  accessPortPattern: 'Gi1/0/{n}',
  accessPortStart: '1',
  uplinkPortCount: '4',
  uplinkPortType: 'SFP',
  uplinkPortSpeed: '1G',
  uplinkPortPattern: 'Gi1/1/{n}',
  uplinkPortStart: '1',
  compatibleSfps: 'Cisco SFP-1G-SX; Cisco SFP-1G-LX',
  price: '1450.00',
  currency: 'EUR',
  servonAvailable: 'no',
}

async function downloadTemplate() {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.json_to_sheet([EXAMPLE_ROW], { header: CATALOGUE_CSV_COLUMNS })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Catalogue')
  XLSX.writeFile(book, 'rackium-catalogue-template.csv', { bookType: 'csv' })
}

// Org Admin CSV/Excel import into the organisation layer. The preview runs
// the shared validator; the server runs it again and writes all rows or none.
export default function CatalogueImportPanel({ orgId, existingItems, onClose, onImported }) {
  const [fileName, setFileName] = useState(null)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const result = useMemo(() => (rows ? validateCatalogueRows(rows) : null), [rows])
  const existingKeys = useMemo(() => new Set(existingItems.map((i) => `${i.kind}|${i.key.toLowerCase()}`)), [existingItems])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const parsed = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '', raw: false })
      const cleaned = parsed
        .map((row) => Object.fromEntries(CATALOGUE_CSV_COLUMNS.map((c) => [c, String(row[c] ?? '').trim()])))
        .filter((row) => Object.values(row).some(Boolean))
      if (cleaned.length === 0) throw new Error('empty')
      setFileName(file.name)
      setRows(cleaned)
    } catch {
      setError('Could not read this file. Use the template’s columns, with a header row.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function commit() {
    setBusy(true)
    setError(null)
    try {
      const res = await catalogueApi.import(orgId, rows)
      onImported(res.imported)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const errorCount = result?.rows.filter((r) => r.errors.length).length ?? 0

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">Import catalogue items (CSV or Excel)</h2>
        <button type="button" onClick={onClose} aria-label="Close import" className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <p className="text-xs text-text-secondary">
        One row per item. Lists (compatible parts) are separated by “;”. Port patterns use {'{n}'} for the number, or {'{n:2}'} to zero-pad it. Rows matching an existing organisation item update it.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={downloadTemplate} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand">
          <Download size={14} strokeWidth={2} />
          Download template
        </button>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} className="hidden" aria-label="Catalogue file" />
        <button type="button" onClick={() => inputRef.current?.click()} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand">
          <Upload size={14} strokeWidth={2} />
          Choose file
        </button>
      </div>

      {error && <p className="text-xs text-status-red">{error}</p>}

      {result && (
        <>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-text-secondary">
              {fileName} · {result.rows.length} row(s)
            </span>
            {errorCount === 0 ? (
              <span className="flex items-center gap-1 text-status-green">
                <CheckCircle2 size={13} strokeWidth={2} />
                All rows valid
              </span>
            ) : (
              <span className="flex items-center gap-1 text-status-red">
                <AlertTriangle size={13} strokeWidth={2} />
                {errorCount} row(s) with errors — nothing is imported until every row is valid
              </span>
            )}
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-max text-left text-xs">
              <thead className="sticky top-0 bg-surface-muted">
                <tr className="border-b border-border text-text-secondary">
                  {['Row', 'Item', 'Kind', 'Category', 'Result'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const source = rows[r.index]
                  const isUpdate = r.key && existingKeys.has(`${r.item.kind}|${r.key.toLowerCase()}`)
                  return (
                    <tr key={r.index} className={`border-b border-border/60 last:border-0 ${r.errors.length ? 'bg-status-red/5' : ''}`}>
                      <td className="px-2 py-1 text-text-secondary">{r.index + 2}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-text">
                        {source.vendor} {source.model}
                      </td>
                      <td className="px-2 py-1 text-text-secondary">{source.kind}</td>
                      <td className="px-2 py-1 text-text-secondary">{source.category}</td>
                      <td className="px-2 py-1">
                        {r.errors.length ? (
                          <span className="text-status-red">{r.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}</span>
                        ) : (
                          <span className="text-status-green">{isUpdate ? 'Updates existing item' : 'New item'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={busy || errorCount > 0}
            onClick={commit}
            className="h-9 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Importing…' : `Import ${result.rows.length} item(s)`}
          </button>
        </>
      )}
    </div>
  )
}
