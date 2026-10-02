import FormField from './FormField.jsx'
import { rackInstanceCalculatedValue } from '../../lib/surveyFormModel.js'

// Rack Layout's repeatable_per:'rack' section — one card per real rack in
// the room (never user-added/removed here; racks come from Site
// Structure), reconciled by api/surveyFormsDesign.js. `rack_elevation`
// links into the existing Rack Survey screen instead of being a typed
// field — brief: "do not rebuild it".
export default function RackLayoutSection({ section, instances, rackList, buildingId, editable, onFieldChange, onValidateSerial }) {
  if (rackList.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-center text-xs text-text-secondary">
        No racks placed in this room yet — add one in Site Structure first.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {rackList.map((rack) => {
        const instance = instances.find((i) => i.rackId === rack.id) ?? { rackId: rack.id }
        const rackCtx = { rackCode: rack.code, rackPosition: rack.rackPosition }
        return (
          <div key={rack.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 text-sm font-semibold text-text">Rack {rack.code}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.fields.map((field) => {
                const calculated = rackInstanceCalculatedValue(field.key, rackCtx)
                return (
                  <FormField
                    key={field.key}
                    field={field}
                    value={instance[field.key]}
                    editable={editable}
                    calculatedValue={calculated}
                    linkTo={field.type === 'rack_elevation' ? `/b/${buildingId}/survey/rack?rack=${rack.id}` : undefined}
                    onChange={(v) => onFieldChange(rack.id, field.key, v)}
                    onValidateSerial={field.type === 'serial' ? onValidateSerial : undefined}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
