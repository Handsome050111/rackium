// Placeholder wordmark until Technonex supplies the Rackium logo SVG
// (brief v2.3 §8.3 inputs list). Swap the mark below for the real asset
// without touching layout — nothing else references this file's internals.

export default function Logo({ className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M2 2H14V6H6V14H2V2Z" fill="#094F9A" />
        <rect x="17" y="17" width="9" height="9" rx="1.5" fill="#ED1A4C" />
      </svg>
      <span className="text-lg font-bold tracking-tight text-brand">Rackium</span>
    </div>
  )
}
