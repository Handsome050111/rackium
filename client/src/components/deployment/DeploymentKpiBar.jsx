import { Server, Wifi, Link2, TrendingUp, AlertTriangle } from 'lucide-react'

function Kpi({ icon: Icon, value, label, tone = 'text-brand' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Icon size={18} strokeWidth={2} className={`shrink-0 ${tone}`} />
      <div>
        <div className="text-lg font-bold leading-tight text-text">{value}</div>
        <div className="text-[11px] text-text-secondary">{label}</div>
      </div>
    </div>
  )
}

// Every figure is calculated from real device/connection status (brief
// Step 8: "KPIs CALCULATED").
export default function DeploymentKpiBar({ kpis }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi icon={Server} value={`${kpis.devicesInstalled}/${kpis.totalDevices}`} label="devices installed" />
      <Kpi icon={Wifi} value={`${kpis.apsMounted}/${kpis.totalAps}`} label="APs mounted" />
      <Kpi icon={Link2} value={`${kpis.uplinksLive}/${kpis.totalUplinks}`} label="uplinks live" />
      <Kpi icon={TrendingUp} value={`${kpis.overallProgress}%`} label="overall progress" />
      <Kpi icon={AlertTriangle} value={kpis.openIssues} label="open issues" tone={kpis.openIssues > 0 ? 'text-status-amber' : 'text-status-green'} />
    </div>
  )
}
