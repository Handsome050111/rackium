import { useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import TopBar from './TopBar.jsx'
import Sidebar from './Sidebar.jsx'
import { isHandoverAccepted } from '../api/designFreeze.js'
import { subscribePhaseStatusChanges } from '../api/phaseStatusStore.js'

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { buildingId } = useParams()
  const [handoverAccepted, setHandoverAccepted] = useState(false)

  useEffect(() => {
    if (!buildingId) return
    let active = true
    function load() {
      isHandoverAccepted(buildingId).then((accepted) => {
        if (active) setHandoverAccepted(accepted)
      })
    }
    load()
    const unsubscribe = subscribePhaseStatusChanges(load)
    return () => {
      active = false
      unsubscribe()
    }
  }, [buildingId])

  return (
    <div className="flex h-screen flex-col">
      <TopBar onMenuClick={() => setMobileOpen(true)} />
      {handoverAccepted && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 bg-status-green/10 px-3 py-1.5 text-xs font-medium text-status-green">
          <Lock size={12} strokeWidth={2} />
          Handover accepted — design phases for this building are read-only. CMDB remains editable for operational changes.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          mobileOpen={mobileOpen}
          onOpenMobile={() => setMobileOpen(true)}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <main className="min-w-0 flex-1 overflow-y-auto bg-surface-muted">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
