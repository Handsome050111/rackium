import { Archive } from 'lucide-react'

const TOOL_LABEL = { break: 'Broken', split: 'Split', merge: 'Merged' }
const when = (at) => (at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')

// Uplinks the HLD tools took out of the design (M7b-3, DATA-MODEL §5.20):
// archived, not deleted (addendum v2.3 Q1) — kept here with the reason, who
// and when. Newest first.
export default function ArchivedUplinks({ list }) {
  if (!list?.length) return null
  return (
    <details className="rounded-xl border border-border bg-surface p-3 text-xs" data-testid="archived-uplinks">
      <summary className="flex min-h-[32px] cursor-pointer list-none items-center gap-1.5 font-semibold text-text">
        <Archive size={14} strokeWidth={2} className="text-text-secondary" />
        Archived uplinks ({list.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {list.map((a) => (
          <li key={a.id} className="space-y-0.5 border-t border-border/60 pt-2 first:border-0 first:pt-0">
            <div className="break-all font-medium text-text">
              {a.sourceName} — {a.destName}
            </div>
            <div className="text-text-secondary">
              {TOOL_LABEL[a.tool] ?? a.tool} · {a.media.toUpperCase()} {a.speed}
              {a.reason ? ` · ${a.reason}` : ''}
            </div>
            <div className="text-text-secondary">
              {a.by ?? 'someone'} · {when(a.at)}
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}
