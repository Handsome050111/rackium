import {
  MousePointer2,
  Move,
  Link2,
  Unlink,
  Redo2 as Reroute,
  Repeat,
  Split,
  Merge,
  Cable,
  CheckCircle2,
  Undo2,
  Redo2,
  Trash2,
} from 'lucide-react'

// Per brief v2.2 §3.6. Break Uplink, Reroute, Replace Endpoint, Split and
// Merge arrived in M7b-3 (DATA-MODEL §5.20; addendum v2.3 Q1) — on the real
// HLD (`designTools`); the mock screen still shows them as coming later.
const TOOLS = [
  { id: 'select', label: 'Select', icon: MousePointer2, active: true },
  { id: 'move', label: 'Move', icon: Move, active: true },
  { id: 'create-uplink', label: 'Create Uplink', icon: Link2, active: true },
  { id: 'break-uplink', label: 'Break Uplink', icon: Unlink, active: true, tool: true },
  { id: 'reroute', label: 'Reroute', icon: Reroute, active: true, tool: true },
  { id: 'replace-endpoint', label: 'Replace Endpoint', icon: Repeat, active: true, tool: true },
  { id: 'split', label: 'Split', icon: Split, active: true, tool: true },
  { id: 'merge', label: 'Merge', icon: Merge, active: true, tool: true },
  { id: 'change-medium', label: 'Change Medium', icon: Cable, active: true },
  { id: 'validate', label: 'Validate', icon: CheckCircle2, active: true },
]

export default function HldToolbar({ mode, onSelectTool, onUndo, canUndo, onRedo, canRedo, onDelete, canDelete, disabled, designTools = false }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface p-1.5">
      {TOOLS.map((tool) => {
        const enabled = tool.active && (!tool.tool || designTools) && !disabled
        return (
          <button
            key={tool.id}
            type="button"
            disabled={!enabled}
            onClick={() => onSelectTool(tool.id)}
            title={enabled ? tool.label : `${tool.label} — coming later`}
            aria-label={tool.label}
            className={`flex h-touch w-touch items-center justify-center rounded-lg sm:h-9 sm:w-9 ${
              mode === tool.id && enabled ? 'bg-brand/10 text-brand' : 'text-brand hover:bg-surface-muted'
            } disabled:cursor-not-allowed disabled:text-status-grey disabled:hover:bg-transparent`}
          >
            <tool.icon size={17} strokeWidth={2} />
          </button>
        )
      })}
      <div className="mx-1 h-5 w-px bg-border" />
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo || disabled}
        title="Undo"
        className="flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-status-grey disabled:hover:bg-transparent sm:h-9 sm:w-9"
      >
        <Undo2 size={17} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo || disabled}
        title="Redo"
        className="flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-status-grey disabled:hover:bg-transparent sm:h-9 sm:w-9"
      >
        <Redo2 size={17} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete || disabled}
        title="Delete"
        className="flex h-touch w-touch items-center justify-center rounded-lg text-status-red hover:bg-status-red/5 disabled:cursor-not-allowed disabled:text-status-grey disabled:hover:bg-transparent sm:h-9 sm:w-9"
      >
        <Trash2 size={17} strokeWidth={2} />
      </button>
    </div>
  )
}
