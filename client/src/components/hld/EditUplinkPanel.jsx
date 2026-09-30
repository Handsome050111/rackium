import { Check, CheckCircle2, XCircle, Info } from 'lucide-react'
import { getCompatibleSfps } from '../../mock/sfpCatalog.js'

const STEPS = ['Endpoints', 'Ports', 'Medium & SFP', 'Validate']

const MEDIA_OPTIONS = [
  { value: 'cat6a', label: 'Cat6A' },
  { value: 'os2', label: 'OS2 single-mode' },
  { value: 'om4', label: 'OM4 multimode' },
  { value: 'dac', label: 'DAC' },
  { value: 'stack', label: 'Stack cable' },
]
const SPEED_OPTIONS = ['1G', '10G', '40G']

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-surface-muted'

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

function StepIndicator({ step, onStepChange }) {
  return (
    <div className="mb-4 flex items-center">
      {STEPS.map((label, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'current' : 'upcoming'
        return (
          <div key={label} className="flex flex-1 items-center">
            <button
              type="button"
              onClick={() => onStepChange(n)}
              className="flex flex-col items-center gap-1"
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                  state === 'done'
                    ? 'border-status-green bg-status-green/10 text-status-green'
                    : state === 'current'
                      ? 'border-brand bg-brand text-white'
                      : 'border-border text-text-secondary'
                }`}
              >
                {state === 'done' ? <Check size={14} strokeWidth={2.5} /> : n}
              </span>
              <span className={`text-[10px] ${state === 'current' ? 'font-semibold text-brand' : 'text-text-secondary'}`}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <div className="mx-1 h-0.5 flex-1 bg-border" />}
          </div>
        )
      })}
    </div>
  )
}

const FINDING_ICON = { pass: CheckCircle2, fail: XCircle, info: Info }
const FINDING_COLOR = { pass: 'text-status-green', fail: 'text-status-red', info: 'text-status-amber' }

export default function EditUplinkPanel({
  step,
  onStepChange,
  draft,
  onDraftChange,
  devices,
  validation,
  onValidate,
  onApply,
  onCancel,
  disabled,
}) {
  const sourceDevice = devices.find((d) => d.id === draft.sourceDeviceId)
  const destDevice = devices.find((d) => d.id === draft.destDeviceId)
  const sfpOptions = getCompatibleSfps(draft.media, draft.speed).map((s) => s.code)

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="text-sm font-semibold text-text">Edit Uplink</div>
      <StepIndicator step={step} onStepChange={onStepChange} />

      {step === 1 && (
        <div className="space-y-3">
          <Field label="Source device">
            <select
              value={draft.sourceDeviceId ?? ''}
              onChange={(e) => onDraftChange({ sourceDeviceId: e.target.value, sourcePort: null })}
              disabled={disabled}
              className={inputClass}
            >
              <option value="">Select…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.role} · {d.hostname}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Destination device">
            <select
              value={draft.destDeviceId ?? ''}
              onChange={(e) => onDraftChange({ destDeviceId: e.target.value, destPort: null })}
              disabled={disabled}
              className={inputClass}
            >
              <option value="">Select…</option>
              {devices
                .filter((d) => d.id !== draft.sourceDeviceId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.role} · {d.hostname}
                  </option>
                ))}
            </select>
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">Port selection is optional in HLD — it becomes mandatory in LLD (brief v2.3 §5.3).</p>
          <Field label={`Source port (${sourceDevice?.hostname ?? '—'})`}>
            <input
              type="text"
              value={draft.sourcePort ?? ''}
              onChange={(e) => onDraftChange({ sourcePort: e.target.value || null })}
              disabled={disabled}
              placeholder="Optional, e.g. Te1/1/4"
              className={inputClass}
            />
          </Field>
          <Field label={`Destination port (${destDevice?.hostname ?? '—'})`}>
            <input
              type="text"
              value={draft.destPort ?? ''}
              onChange={(e) => onDraftChange({ destPort: e.target.value || null })}
              disabled={disabled}
              placeholder="Optional, e.g. Gi1/0/1"
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-text">
            <input
              type="checkbox"
              checked={draft.usePatchPanel}
              onChange={(e) => onDraftChange({ usePatchPanel: e.target.checked })}
              disabled={disabled}
            />
            Route via destination room's patch panel
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <Field label="Required speed">
            <select value={draft.speed} onChange={(e) => onDraftChange({ speed: e.target.value })} disabled={disabled} className={inputClass}>
              {SPEED_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Selected medium">
            <select value={draft.media} onChange={(e) => onDraftChange({ media: e.target.value })} disabled={disabled} className={inputClass}>
              {MEDIA_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source SFP">
            <select value={draft.sourceSfp ?? ''} onChange={(e) => onDraftChange({ sourceSfp: e.target.value })} disabled={disabled} className={inputClass}>
              <option value="">Select…</option>
              {sfpOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Destination SFP">
            <select value={draft.destSfp ?? ''} onChange={(e) => onDraftChange({ destSfp: e.target.value })} disabled={disabled} className={inputClass}>
              <option value="">Select…</option>
              {sfpOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={onValidate}
            disabled={disabled}
            className="h-touch w-full rounded-lg border border-brand text-sm font-medium text-brand hover:bg-brand/5 disabled:cursor-not-allowed sm:h-9"
          >
            Run NexAI validation
          </button>

          {validation && (
            <>
              {validation.estimatedLengthM != null && (
                <p className="text-xs text-text-secondary">Estimated length: {Math.round(validation.estimatedLengthM)} m</p>
              )}
              {validation.patchPanelFreePorts != null && (
                <p className="text-xs text-text-secondary">Destination patch panel: {validation.patchPanelFreePorts} free ports</p>
              )}
              <div className="space-y-1.5 rounded-xl border border-border p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-text">NexAI validation</div>
                {validation.findings.map((f) => {
                  const Icon = FINDING_ICON[f.status]
                  return (
                    <div key={f.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 text-text">
                        <Icon size={14} strokeWidth={2} className={FINDING_COLOR[f.status]} />
                        {f.label}
                      </span>
                      <span className={`font-medium ${FINDING_COLOR[f.status]}`}>{f.message}</span>
                    </div>
                  )
                })}
              </div>
              <div
                className={`rounded-lg border px-3 py-2 text-center text-xs font-semibold ${
                  validation.blocked
                    ? 'border-status-red/30 bg-status-red/10 text-status-red'
                    : 'border-status-green/30 bg-status-green/10 text-status-green'
                }`}
              >
                {validation.blocked ? 'BLOCKED — resolve the failing checks above' : 'VALID CONNECTION'}
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex justify-between gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => onStepChange(Math.max(1, step - 1))}
          disabled={step === 1}
          className="h-touch rounded-lg border border-border px-3 text-xs font-medium text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 sm:h-9"
        >
          Back
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-touch rounded-lg border border-border px-3 text-xs font-medium text-text hover:bg-surface-muted sm:h-9"
          >
            Cancel
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={() => onStepChange(step + 1)}
              disabled={disabled || (step === 1 && (!draft.sourceDeviceId || !draft.destDeviceId))}
              className="h-touch rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={onApply}
              disabled={disabled || !validation || validation.blocked}
              className="h-touch rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
            >
              Apply &amp; Validate Uplink
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
