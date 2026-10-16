// A CMO device imported without a serial (fix/cmo-naming-gaps): it imports
// and can be picked from the CMO list in the survey, but is never
// serial-validated there.
export default function NoSerialBadge() {
  return (
    <span className="rounded bg-status-amber/10 px-1.5 py-0.5 text-[11px] font-medium text-status-amber" title="Imported without a serial — picked from the CMO list in the survey, not serial-validated">
      No serial
    </span>
  )
}
