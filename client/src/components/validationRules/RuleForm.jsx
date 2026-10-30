import { useState } from 'react'
import { RULE_OBJECTS, RULE_SEVERITIES, OPERATOR_LABEL, operatorsFor, operatorTakesValue, operatorTakesList, placeholdersOf, ruleField, ruleProblems, fieldOptions } from '@rackium/shared/customRules.js'
import { HLD_ROLES } from '@rackium/shared/hldRoles.js'

const input = 'h-touch w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none sm:h-9'
const SEVERITY_LABEL = { critical: 'Critical — blocks submit', warning: 'Warning', info: 'Info' }

function Field({ label, error, children }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs">
      <span className="text-text-secondary">{label}</span>
      {children}
      {error && <span className="text-status-red">{error}</span>}
    </label>
  )
}

// What a form holds as the API takes it: a number from its box, nothing for
// the conditions that take no value.
function toBody(form) {
  const field = ruleField(form.object, form.field)
  const takesValue = operatorTakesValue(form.operator)
  let value = null
  if (takesValue) {
    if (operatorTakesList(form.operator)) value = Array.isArray(form.value) ? form.value : String(form.value ?? '').split(',').map((v) => v.trim()).filter(Boolean)
    else if (field?.type === 'number') value = form.value === '' || form.value == null ? null : Number(form.value)
    else if (field?.type === 'boolean') value = form.value === true || form.value === 'true'
    else value = form.value ?? null
  }
  return { name: form.name.trim(), object: form.object, subjectRole: form.object === 'device' ? form.subjectRole || null : null, field: form.field, operator: form.operator, value, severity: form.severity, message: form.message.trim() || null }
}

const EMPTY = { name: '', object: 'device', subjectRole: '', field: 'uplinkCount', operator: 'lt', value: '', severity: 'warning', message: '' }

// The builder (M7b-5; v2.2 §3.4): IF [subject] [one condition] THEN [severity]
// [message]. Every choice comes from the allowlist; the same check as the
// server's says what is missing. `targets`: the buildings a draft can be tried
// on ({ key, label, projectId, buildingId }); `onPreview(target, body)`.
export default function RuleForm({ rule = null, labels, targets = [], onPreview, onSave, onCancel }) {
  const [form, setForm] = useState(() => (rule ? { ...EMPTY, ...rule, subjectRole: rule.subjectRole ?? '', message: rule.message ?? '', value: rule.value ?? '' } : EMPTY))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [target, setTarget] = useState(targets[0]?.key ?? '')
  const [preview, setPreview] = useState(null)

  const object = RULE_OBJECTS[form.object]
  const field = ruleField(form.object, form.field)
  const body = toBody(form)
  const problems = ruleProblems(body)
  const problem = (path) => (tried ? problems.find((p) => p.path === path)?.message : null)
  const nameMissing = tried && !body.name ? 'Name the rule' : null
  const ready = body.name && !problems.length
  const options = fieldOptions(field, labels)
  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }))
    setPreview(null)
  }

  function chooseObject(next) {
    const [first] = Object.keys(RULE_OBJECTS[next].fields)
    set({ object: next, subjectRole: '', field: first, operator: operatorsFor(RULE_OBJECTS[next].fields[first].type)[0], value: '', message: '' })
  }
  function chooseField(next) {
    set({ field: next, operator: operatorsFor(object.fields[next].type)[0], value: '' })
  }
  function chooseOperator(next) {
    set({ operator: next, value: operatorTakesList(next) ? [] : '' })
  }
  const toggleInList = (value) => set({ value: (Array.isArray(form.value) ? form.value : []).includes(value) ? form.value.filter((v) => v !== value) : [...(Array.isArray(form.value) ? form.value : []), value] })

  async function save(e) {
    e.preventDefault()
    setTried(true)
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await onSave(body)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  async function runPreview() {
    setTried(true)
    if (!ready) return
    setError(null)
    try {
      setPreview(await onPreview(targets.find((t) => t.key === target), body))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <form onSubmit={save} data-testid="rule-form" className="space-y-3 rounded-xl border border-brand/30 bg-surface p-4">
      <Field label="Rule name" error={nameMissing}>
        <input className={input} value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Checks each" error={problem('object')}>
          <select className={input} value={form.object} onChange={(e) => chooseObject(e.target.value)}>
            {Object.entries(RULE_OBJECTS).map(([key, o]) => (
              <option key={key} value={key}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {form.object === 'device' && (
          <Field label="Only this role" error={problem('subjectRole')}>
            <select className={input} value={form.subjectRole} onChange={(e) => set({ subjectRole: e.target.value })}>
              <option value="">Any device</option>
              {HLD_ROLES.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="If its" error={problem('field')}>
          <select className={input} value={form.field} onChange={(e) => chooseField(e.target.value)}>
            {Object.entries(object.fields).map(([key, f]) => (
              <option key={key} value={key}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition" error={problem('operator')}>
          <select className={input} value={form.operator} onChange={(e) => chooseOperator(e.target.value)}>
            {operatorsFor(field?.type).map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABEL[op]}
              </option>
            ))}
          </select>
        </Field>
        {operatorTakesValue(form.operator) && (
          <Field label="Value" error={problem('value')}>
            {field?.type === 'boolean' ? (
              <select className={input} value={String(form.value === '' ? false : form.value)} onChange={(e) => set({ value: e.target.value === 'true' })}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : options && operatorTakesList(form.operator) ? (
              <div role="group" aria-label="Values" className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
                {options.map((o) => (
                  <span key={o.value} className="flex items-center gap-2 text-sm text-text">
                    <input type="checkbox" aria-label={o.label} checked={(Array.isArray(form.value) ? form.value : []).includes(o.value)} onChange={() => toggleInList(o.value)} />
                    {o.label}
                  </span>
                ))}
              </div>
            ) : options ? (
              <select className={input} value={form.value} onChange={(e) => set({ value: e.target.value })}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : operatorTakesList(form.operator) ? (
              <input className={input} value={Array.isArray(form.value) ? form.value.join(', ') : form.value} placeholder="Separate with commas" onChange={(e) => set({ value: e.target.value })} />
            ) : (
              <input className={input} type={field?.type === 'number' ? 'number' : 'text'} step="any" value={form.value} onChange={(e) => set({ value: e.target.value })} />
            )}
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label="Then show as">
          <select className={input} value={form.severity} onChange={(e) => set({ severity: e.target.value })}>
            {RULE_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Message (optional)" error={problem('message')}>
          <input className={input} value={form.message} maxLength={300} onChange={(e) => set({ message: e.target.value })} />
        </Field>
      </div>
      <p className="text-xs text-text-secondary">Message can use: {placeholdersOf(form.object).map((p) => `{${p}}`).join(', ')}</p>

      {onPreview && targets.length > 0 && (
        <div className="space-y-2 rounded-lg bg-surface-muted p-3" data-testid="rule-preview">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Try it on">
              <select className={input} value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" onClick={runPreview} className="h-touch shrink-0 rounded-lg border border-brand px-3 text-sm font-medium text-brand hover:bg-brand/5 sm:h-9">
              Preview
            </button>
          </div>
          {preview && (
            <div className="text-xs text-text">
              <p role="status" className="font-medium">
                Would flag {preview.count} item{preview.count === 1 ? '' : 's'} in the {preview.stage.toUpperCase()} now.
              </p>
              {preview.samples.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-secondary">
                  {preview.samples.map((s, i) => (
                    <li key={i} className="break-words">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-status-red">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="h-touch rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9">
          Save rule
        </button>
        <button type="button" onClick={onCancel} className="h-touch rounded-lg border border-border px-4 text-sm font-medium text-text-secondary hover:text-text sm:h-9">
          Cancel
        </button>
      </div>
    </form>
  )
}
