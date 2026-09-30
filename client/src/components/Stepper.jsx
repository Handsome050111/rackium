import { PHASE_ICONS } from '../lib/phaseIcons.js'
import { phaseStatus } from '../tokens/design-tokens.js'

const COLOR_CLASSES = {
  grey: 'border-status-grey text-status-grey',
  amber: 'border-status-amber text-status-amber',
  red: 'border-status-red text-status-red',
  green: 'border-status-green text-status-green',
}

export default function Stepper({ phases }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-start px-1 py-2">
        {phases.map((phase, i) => {
          const Icon = PHASE_ICONS[phase.icon]
          const meta = phaseStatus[phase.status]
          return (
            <div key={phase.id} className="flex items-start">
              <div className="flex w-18 flex-col items-center gap-1 text-center">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 bg-surface ${COLOR_CLASSES[meta.color]}`}
                >
                  <Icon size={15} strokeWidth={2} className={meta.pulsing ? 'animate-pulse' : ''} />
                </span>
                <span className="text-[10.5px] font-medium leading-tight text-text">{phase.stepperLabel}</span>
                <span className={`text-[10.5px] font-medium leading-tight ${COLOR_CLASSES[meta.color].split(' ')[1]}`}>
                  {meta.label}
                </span>
              </div>
              {i < phases.length - 1 && <div className="mt-4 h-0.5 w-3 shrink-0 bg-border" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
