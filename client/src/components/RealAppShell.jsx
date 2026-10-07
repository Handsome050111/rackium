import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import TopBar from './TopBar.jsx'
import ViewAsBanner from './ViewAsBanner.jsx'
import RealSidebar from './RealSidebar.jsx'

// The shell for real-mode (organisation/project) screens. This duplicates
// AppShell's layout rather than extending it, because AppShell/Sidebar are
// hard-wired to the mock prototype's single buildingId route and must keep
// working unchanged (M2 approval, item 9). A later milestone should unify
// the two shells once the mock prototype's role in the product is settled;
// for now they share their inner pieces (TopBar, PhaseCard, StatusDot,
// KpiStrip, ...) rather than duplicating those.
export default function RealAppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()
  const projectMatch = pathname.match(/^\/orgs\/[^/]+\/projects\/([^/]+)/)
  const settingsTo = projectMatch ? `/orgs/${pathname.match(/^\/orgs\/([^/]+)/)[1]}/projects/${projectMatch[1]}/settings` : null

  return (
    <div className="flex h-screen flex-col">
      <TopBar onMenuClick={() => setMobileOpen(true)} settingsTo={settingsTo} />
      <ViewAsBanner />
      <div className="flex min-h-0 flex-1">
        <RealSidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
        <main className="min-w-0 flex-1 overflow-y-auto bg-surface-muted">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
