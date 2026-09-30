import { Undo2, Redo2, ArrowLeftRight } from 'lucide-react'

function ToolButton({ icon: Icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-status-grey disabled:hover:bg-transparent sm:h-9 sm:w-9"
    >
      <Icon size={18} strokeWidth={2} />
    </button>
  )
}

export default function EditorToolbar({ onUndo, canUndo, onRedo, canRedo, onSwap, canSwap }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1.5">
      <ToolButton icon={Undo2} label="Undo" onClick={onUndo} disabled={!canUndo} />
      <ToolButton icon={Redo2} label="Redo" onClick={onRedo} disabled={!canRedo} />
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolButton icon={ArrowLeftRight} label="Swap source and destination" onClick={onSwap} disabled={!canSwap} />
    </div>
  )
}
