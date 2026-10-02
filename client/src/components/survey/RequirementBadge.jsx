// brief v2.3 §5.2: must = red, good_to_have = yellow, must_if_allowed = red
// with an "if allowed" note.
export default function RequirementBadge({ requirement }) {
  if (requirement === 'must') {
    return <span className="rounded border border-status-red/40 bg-status-red/5 px-1 text-[10px] font-semibold text-status-red">Must</span>
  }
  if (requirement === 'must_if_allowed') {
    return <span className="rounded border border-status-red/40 bg-status-red/5 px-1 text-[10px] font-semibold text-status-red">Must, if allowed</span>
  }
  if (requirement === 'good_to_have') {
    return <span className="rounded border border-status-amber/40 bg-status-amber/5 px-1 text-[10px] font-semibold text-status-amber">Good to have</span>
  }
  return null
}
