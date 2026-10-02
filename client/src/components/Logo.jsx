import logoUrl from '../assets/rackium-logo.svg'

// Full wordmark (brief: top bar, login, client approval page). Height-constrained,
// width auto, so the SVG's own aspect ratio is always preserved — never stretched.
export default function Logo({ className = '' }) {
  return <img src={logoUrl} alt="Rackium" className={`h-7 w-auto ${className}`} />
}
