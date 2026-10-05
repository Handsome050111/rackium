import { Loader2, CloudCheck, CloudOff } from 'lucide-react'
import { formatRelativeTime } from '@rackium/shared/time.js'

// status: 'saved' | 'saving' | 'unsaved'
export default function AutosaveIndicator({ status, lastSavedAt }) {
  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
        <Loader2 size={14} strokeWidth={2} className="animate-spin" />
        Saving…
      </span>
    )
  }
  if (status === 'unsaved') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-status-amber">
        <CloudOff size={14} strokeWidth={2} />
        Unsaved changes
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-status-green">
      <CloudCheck size={14} strokeWidth={2} />
      Saved {lastSavedAt ? formatRelativeTime(lastSavedAt) : ''}
    </span>
  )
}
