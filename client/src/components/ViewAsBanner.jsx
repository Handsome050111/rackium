import { Eye } from 'lucide-react'
import { ROLE_LABELS } from '@rackium/shared/policy.js'
import { useViewAs } from '../lib/ViewAsContext.jsx'

// Persistent while a View As session is active. All write controls under it
// must also disable themselves (checked with useViewAs().session) — this is
// in addition to the server's own 403s on any write, not instead of them.
export default function ViewAsBanner() {
  const { session, end } = useViewAs()
  if (!session) return null

  return (
    <div className="flex shrink-0 items-center justify-center gap-2 bg-status-amber/10 px-3 py-1.5 text-xs font-medium text-status-amber">
      <Eye size={14} strokeWidth={2} />
      Viewing as {ROLE_LABELS[session.viewedRole] ?? session.viewedRole}
      <button type="button" onClick={() => end()} className="font-semibold underline hover:no-underline">
        Exit
      </button>
    </div>
  )
}
