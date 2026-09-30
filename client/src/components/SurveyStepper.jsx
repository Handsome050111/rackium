import { useNavigate } from 'react-router-dom'

export const SURVEY_STEPS = [
  { id: 'site-structure', label: 'Site Structure' },
  { id: 'room-details', label: 'Room Details' },
  { id: 'rack-survey', label: 'Rack Survey' },
  { id: 'building-connections', label: 'Building Connections' },
  { id: 'validation', label: 'Validation' },
]

// `links` maps a step id to a route, or omits it if that step isn't
// reachable from here yet (e.g. Room Details — not built in this step).
export default function SurveyStepper({ active, links = {} }) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-text-secondary">
      {SURVEY_STEPS.map((step, i) => {
        const href = links[step.id]
        const isActive = step.id === active
        const clickable = Boolean(href) && !isActive

        return (
          <div key={step.id} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && navigate(href)}
              title={!href && !isActive ? 'Coming in a later step' : undefined}
              className={`flex h-touch items-center gap-1.5 rounded px-1 sm:h-auto ${
                clickable ? 'cursor-pointer hover:text-brand' : 'cursor-default'
              } ${!href && !isActive ? 'opacity-50' : ''}`}
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isActive ? 'bg-brand' : 'border border-border bg-surface'}`} />
              <span className={isActive ? 'font-semibold text-brand' : ''}>{step.label}</span>
            </button>
            {i < SURVEY_STEPS.length - 1 && <span className="mx-1 hidden h-px w-6 bg-border sm:block" />}
          </div>
        )
      })}
    </div>
  )
}
