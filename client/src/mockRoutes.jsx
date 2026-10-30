// The prototype's screens (mock mode only): loaded on demand by App.jsx, and in
// no release build. Importing this also registers the mock stores, which is why
// main.jsx loads it before it restores them.
import { Link, Route, Routes } from 'react-router-dom'
import RequireAuth from './components/RequireAuth.jsx'
import AppShell from './components/AppShell.jsx'
import BuildingOverview from './pages/BuildingOverview.jsx'
import Lld from './pages/Lld.jsx'
import RackiumEditor from './pages/RackiumEditor.jsx'
import SiteStructure from './pages/SiteStructure.jsx'
import SurveyRackLayout from './pages/SurveyRackLayout.jsx'
import RoomDetails from './pages/RoomDetails.jsx'
import Hld from './pages/Hld.jsx'
import Bom from './pages/Bom.jsx'
import SolutionPackage from './pages/SolutionPackage.jsx'
import ClientApproval from './pages/ClientApproval.jsx'
import DemoGuide from './pages/DemoGuide.jsx'
import Settings from './pages/Settings.jsx'
import Activity from './pages/Activity.jsx'
import Deployment from './pages/Deployment.jsx'
import Cmdb from './pages/Cmdb.jsx'
import Cmo from './pages/Cmo.jsx'
import Handover from './pages/Handover.jsx'

export { DemoGuide, ClientApproval }

// Shown for any /b/:buildingId/:segment that is not a known screen.
function PageNotFound() {
  return (
    <div className="p-6">
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-base font-semibold text-text">Page not found</h1>
        <p className="mt-2 text-sm text-text-secondary">This page does not exist in the prototype.</p>
        <Link to="/b/b001" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          Back to the building overview
        </Link>
      </div>
    </div>
  )
}

export function MockBuildingRoutes() {
  return (
    <Routes>
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<BuildingOverview />} />
        <Route path="cmo" element={<Cmo />} />
        <Route path="lld" element={<Lld />} />
        <Route path="lld/editor" element={<RackiumEditor />} />
        <Route path="survey" element={<SiteStructure mode="building" />} />
        <Route path="survey/campus" element={<SiteStructure mode="campus" />} />
        <Route path="survey/rack" element={<SurveyRackLayout />} />
        <Route path="survey/room" element={<RoomDetails />} />
        <Route path="hld" element={<Hld />} />
        <Route path="bom" element={<Bom />} />
        <Route path="solution-package" element={<SolutionPackage />} />
        <Route path="deployment" element={<Deployment />} />
        <Route path="cmdb" element={<Cmdb />} />
        <Route path="handover" element={<Handover />} />
        <Route path="settings" element={<Settings />} />
        <Route path="activity" element={<Activity />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  )
}
