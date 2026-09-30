import { Network } from 'lucide-react'

// Read-only for now — the full logical topology canvas is a later step.
export default function LogicalTopologyTable({ vlans }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <Network size={16} strokeWidth={2} className="text-brand" />
        VLANs &amp; subnets
      </div>
      {vlans.length === 0 ? (
        <p className="text-xs text-text-secondary">No logical design captured yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead>
              <tr className="border-b border-border text-text-secondary">
                <th className="py-1.5 pr-3 font-medium">VLAN ID</th>
                <th className="py-1.5 pr-3 font-medium">Name</th>
                <th className="py-1.5 pr-3 font-medium">Subnet</th>
                <th className="py-1.5 font-medium">Gateway</th>
              </tr>
            </thead>
            <tbody>
              {vlans.map((v) => (
                <tr key={v.id} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3 font-medium text-text">{v.id}</td>
                  <td className="py-1.5 pr-3 text-text">{v.name}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{v.subnet}</td>
                  <td className="py-1.5 text-text-secondary">{v.gateway}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
