import { MODE_STATES, MODE_VIEWS } from '@rackium/shared/modeState.js'

const VIEW_LABEL = { show: 'Show', overlay: 'Overlay', hide: 'Hide' }

// The canvas mode states (M7b-4a, DATA-MODEL §5.21): each of CMO, IMO and FMO
// (the configured labels) shown, drawn as an overlay (a ghost) or hidden.
export default function ModeToggles({ labels, view, onChange }) {
  return (
    <div data-testid="mode-toggles" role="group" aria-label="Mode states on the canvas" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {MODE_STATES.map((state) => (
        <div key={state} className="flex items-center gap-1.5">
          <span className="min-w-[2rem] font-semibold text-text">{labels[state]}</span>
          <div role="radiogroup" aria-label={`${labels[state]} on the canvas`} className="flex overflow-hidden rounded-lg border border-border">
            {MODE_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view[state] === v}
                aria-label={`${VIEW_LABEL[v]} ${labels[state]}`}
                onClick={() => onChange({ ...view, [state]: v })}
                className={`h-touch px-2.5 font-medium sm:h-7 ${view[state] === v ? 'bg-brand text-white' : 'bg-surface text-text-secondary hover:text-text'}`}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
