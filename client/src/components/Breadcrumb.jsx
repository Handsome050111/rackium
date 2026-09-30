import { ChevronRight } from 'lucide-react'

export default function Breadcrumb({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-text-secondary">
      {items.map((item, i) => (
        <span key={item.id ?? item.label} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={14} className="shrink-0" />}
          <span className={i === items.length - 1 ? 'font-medium text-brand' : ''}>{item.label}</span>
        </span>
      ))}
    </nav>
  )
}
