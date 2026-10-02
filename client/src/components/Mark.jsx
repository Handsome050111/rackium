import markUrl from '../assets/rackium-mark.svg'

// Square brand mark — used wherever there isn't room for the full wordmark
// (collapsed/icon-only sidebar rail, phone drawer header).
export default function Mark({ className = '' }) {
  return <img src={markUrl} alt="Rackium" className={`h-7 w-7 ${className}`} />
}
