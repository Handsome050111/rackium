import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronDown, Folder, Building2 } from 'lucide-react'

function TreeNode({ label, depth, defaultOpen = true, children, onClick, isSelected }) {
  const [open, setOpen] = useState(defaultOpen)
  const hasChildren = Boolean(children)
  const paddingLeft = 12 + depth * 16

  return (
    <div>
      <button
        type="button"
        onClick={() => (hasChildren ? setOpen((o) => !o) : onClick?.())}
        style={{ paddingLeft }}
        className={`flex h-touch w-full items-center gap-1.5 rounded-lg pr-2 text-left text-sm hover:bg-surface-muted sm:h-9 ${
          isSelected ? 'bg-brand/10 font-semibold text-brand' : 'text-text'
        }`}
      >
        {hasChildren ? (
          open ? (
            <ChevronDown size={14} className="shrink-0 text-text-secondary" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-text-secondary" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {hasChildren ? (
          <Folder size={16} className="shrink-0 text-brand" strokeWidth={2} />
        ) : (
          <Building2 size={16} className="shrink-0 text-brand" strokeWidth={2} />
        )}
        <span className="truncate">{label}</span>
      </button>
      {hasChildren && open && <div>{children}</div>}
    </div>
  )
}

export default function ProjectTree({ tree, selectedBuildingId, onNavigate }) {
  const navigate = useNavigate()
  if (!tree) return null

  return (
    <nav aria-label="Project tree" className="pb-4">
      <div className="px-3 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Projects
      </div>
      {tree.projects.map((p) => (
        <TreeNode key={p.id} label={p.name} depth={0}>
          {p.countries.map((c) => (
            <TreeNode key={c.id} label={c.code} depth={1}>
              {c.sals.map((s) => (
                <TreeNode key={s.id} label={s.code} depth={2}>
                  {s.campuses.map((camp) => (
                    <TreeNode key={camp.id} label={camp.code} depth={3}>
                      {camp.buildings.map((b) => (
                        <TreeNode
                          key={b.id}
                          label={b.code}
                          depth={4}
                          isSelected={b.id === selectedBuildingId}
                          onClick={() => {
                            navigate(`/b/${b.id}`)
                            onNavigate?.()
                          }}
                        />
                      ))}
                    </TreeNode>
                  ))}
                </TreeNode>
              ))}
            </TreeNode>
          ))}
        </TreeNode>
      ))}
    </nav>
  )
}
