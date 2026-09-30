export default function RackFactCard({ icon: Icon, title, rows }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
        {Icon && <Icon size={16} strokeWidth={2} className="text-brand" />}
        {title}
      </div>
      <dl className="space-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-text-secondary">{label}</dt>
            <dd className="text-right font-medium text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
