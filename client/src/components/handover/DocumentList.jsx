import { Download, CheckCircle2, AlertTriangle, Lock } from 'lucide-react'

// 11-document package (v2.2 §3.11). Compile status per document is
// calculated (lib/handoverModel.js); export only works for the 3 documents
// that have a real SheetJS export — the rest are PDF/ZIP stubs, same
// "Available with document engine" treatment as Step 7's Export PDF/Word.
export default function DocumentList({ documents, onExport }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-text-secondary">
            {['Document', 'Format', 'Source', 'Compile status', ''].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.id} className="border-b border-border/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-1.5 font-medium text-text">{d.name}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{d.format}</td>
              <td className="px-3 py-1.5 text-text-secondary">{d.source}</td>
              <td className="whitespace-nowrap px-3 py-1.5">
                <span className={`flex items-center gap-1 ${d.ok ? 'text-status-green' : 'text-status-amber'}`}>
                  {d.ok ? <CheckCircle2 size={12} strokeWidth={2} /> : <AlertTriangle size={12} strokeWidth={2} />}
                  {d.detail}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right">
                {d.exportable ? (
                  <button
                    type="button"
                    onClick={() => onExport(d.id)}
                    className="flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-text hover:border-brand"
                  >
                    <Download size={11} strokeWidth={2} />
                    Export
                  </button>
                ) : (
                  <span title="Available with document engine" className="flex items-center gap-1 text-[11px] text-text-secondary">
                    <Lock size={11} strokeWidth={2} />
                    Document engine
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
