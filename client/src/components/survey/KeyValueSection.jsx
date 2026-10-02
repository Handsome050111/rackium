import FormField from './FormField.jsx'
import { calculatedFieldValue } from '../../lib/surveyFormModel.js'

export default function KeyValueSection({ section, record, ctx, editable, onFieldChange, onConfirmField, onValidateSerial }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 text-sm font-semibold text-text">{section.section}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {section.fields.map((field) => {
          const calculated = ctx ? calculatedFieldValue(field.key, ctx) : undefined
          return (
            <FormField
              key={field.key}
              field={field}
              value={record?.[field.key]}
              confirmed={record?.[`${field.key}__confirmed`]}
              editable={editable}
              calculatedValue={calculated}
              onChange={(v) => onFieldChange(field.key, v)}
              onConfirm={() => onConfirmField(field.key)}
              onValidateSerial={field.type === 'serial' ? onValidateSerial : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}
