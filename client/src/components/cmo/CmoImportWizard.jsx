import { useRef, useState } from 'react'
import { Upload, ArrowLeft, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { CMO_FIELDS, ROW_ERROR_LABEL, guessColumnMapping } from '../../lib/cmoModel.js'
import { parseCmoFile, previewCmoImport, commitCmoImport } from '../../api/cmoDesign.js'

const STEPS = ['upload', 'map', 'preview']

// Takes over the CMO page's main content area while active (same pattern
// as CMDB's Port Connectivity view swap-in) — this is a multi-step wizard,
// too much for an inline panel, and the app has no modal/dialog pattern to
// borrow instead.
export default function CmoImportWizard({ onCancel, onImported }) {
  const [step, setStep] = useState('upload')
  const [fileName, setFileName] = useState(null)
  const [parsed, setParsed] = useState(null) // { headers, rows }
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [committing, setCommitting] = useState(false)
  const inputRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const result = await parseCmoFile(file)
      if (result.rows.length === 0) throw new Error('No data rows found in this file.')
      setFileName(file.name)
      setParsed(result)
      setMapping(guessColumnMapping(result.headers))
      setStep('map')
    } catch {
      setError('Could not read this file. Use an Excel (.xlsx) or CSV file with a header row.')
    }
  }

  async function handleMappingNext() {
    const missingRequired = CMO_FIELDS.filter((f) => f.required && (mapping[f.key] == null || mapping[f.key] < 0))
    if (missingRequired.length > 0) {
      setError(`Map a column for: ${missingRequired.map((f) => f.label).join(', ')}`)
      return
    }
    setError(null)
    const rows = await previewCmoImport(parsed.rows, mapping)
    setPreview(rows)
    setStep('preview')
  }

  async function handleCommit() {
    setCommitting(true)
    const result = await commitCmoImport(preview)
    setCommitting(false)
    onImported(result)
  }

  const validCount = preview?.filter((r) => r.valid).length ?? 0
  const blockedCount = preview ? preview.length - validCount : 0
  const unassignedCount = preview?.filter((r) => r.valid && !r.buildingId).length ?? 0

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          {step !== 'upload' && (
            <button
              type="button"
              onClick={() => setStep(STEPS[STEPS.indexOf(step) - 1])}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted"
            >
              <ArrowLeft size={14} strokeWidth={2} />
            </button>
          )}
          Import CMO Inventory — {step === 'upload' ? 'Upload file' : step === 'map' ? 'Map columns' : 'Preview'}
        </div>
        <button type="button" onClick={onCancel} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {error && <p className="text-xs text-status-red">{error}</p>}

      {step === 'upload' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10 text-center">
          <Upload size={28} strokeWidth={1.5} className="text-text-secondary" />
          <p className="text-sm text-text-secondary">Upload the client's CMO Excel or CSV file.</p>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
          <button type="button" onClick={() => inputRef.current?.click()} className="h-9 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90">
            Choose file
          </button>
        </div>
      )}

      {step === 'map' && parsed && (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">
            {fileName} · {parsed.rows.length} row(s). Map each Rackium field to a column from your file.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CMO_FIELDS.map((field) => (
              <label key={field.key} className="block space-y-1">
                <span className="text-xs text-text-secondary">
                  {field.label}
                  {field.required && <span className="text-status-red"> *</span>}
                </span>
                <select
                  value={mapping[field.key] ?? -1}
                  onChange={(e) => setMapping({ ...mapping, [field.key]: Number(e.target.value) })}
                  className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs text-text focus:border-brand focus:outline-none"
                >
                  <option value={-1}>Not mapped</option>
                  {parsed.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button type="button" onClick={handleMappingNext} className="h-9 w-full rounded-lg bg-brand text-xs font-medium text-white hover:bg-brand/90 sm:w-auto sm:px-6">
            Preview import
          </button>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1 text-status-green">
              <CheckCircle2 size={13} strokeWidth={2} />
              {validCount} valid
            </span>
            {blockedCount > 0 && (
              <span className="flex items-center gap-1 text-status-red">
                <AlertTriangle size={13} strokeWidth={2} />
                {blockedCount} blocked (won't be imported)
              </span>
            )}
            {unassignedCount > 0 && (
              <span className="flex items-center gap-1 text-status-amber">
                <AlertTriangle size={13} strokeWidth={2} />
                {unassignedCount} going to Unassigned
              </span>
            )}
          </div>

          <div className="max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-max text-left text-xs">
              <thead className="sticky top-0 bg-surface-muted">
                <tr className="border-b border-border text-text-secondary">
                  {['Row', 'Hostname', 'Serial', 'MAC', 'Building', 'Room', 'Issues'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.rowIndex} className={`border-b border-border/60 last:border-0 ${!r.valid ? 'bg-status-red/5' : ''}`}>
                    <td className="whitespace-nowrap px-2 py-1 text-text-secondary">{r.rowIndex + 1}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-text">{r.hostname ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-text">{r.serial ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-text-secondary">{r.mac ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-text-secondary">{r.building ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-text-secondary">{r.room ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {r.errors.length === 0 ? (
                        <span className="text-status-green">OK</span>
                      ) : (
                        <span className={r.valid ? 'text-status-amber' : 'text-status-red'}>{r.errors.map((e) => ROW_ERROR_LABEL[e]).join(', ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={committing || validCount === 0}
            onClick={handleCommit}
            className="h-9 w-full rounded-lg bg-brand text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-6"
          >
            {committing ? 'Importing…' : `Commit import (${validCount})`}
          </button>
        </div>
      )}
    </div>
  )
}
